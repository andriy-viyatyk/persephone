# US-454: DrawIO Viewer

## Goal

Add a read-only viewer for `.drawio` files (diagrams.net / draw.io diagrams) so users can open and inspect diagram files directly in Persephone, with multi-page support and full fidelity rendering.

## Background

### `.drawio` file format

`.drawio` files are XML produced by [diagrams.net](https://www.diagrams.net) (formerly draw.io). Two encodings:

1. **Plain XML** — root `<mxfile>` element containing one or more `<diagram>` elements with `<mxGraphModel>` / `<mxCell>` nodes.
2. **Compressed** — the inner content of each `<diagram>` is **deflate-raw + base64-encoded + URI-encoded**. The outer `<mxfile>` and `<diagram>` tags remain plain XML; only the model body is compressed.

A `.drawio` file may contain multiple pages (one `<diagram>` element per page, each with `id` and `name` attributes).

### Rendering library

The diagrams.net team maintains `viewer-static.min.js` ([github.com/jgraph/drawio](https://github.com/jgraph/drawio), Apache-2.0) — a self-contained ~1.5 MB script that exposes `GraphViewer`. This is the same renderer GitHub uses for `.drawio` previews. It auto-decompresses encoded `<diagram>` payloads, supports multi-page tabs natively, and renders into a `<div class="mxgraph" data-mxgraph='{"xml": "..."}'></div>` element when `GraphViewer.processElements()` is called.

### Existing patterns to follow

This task most closely mirrors the **PDF viewer** pattern:

- [src/renderer/editors/pdf/PdfViewer.tsx](../../../src/renderer/editors/pdf/PdfViewer.tsx) — standalone editor that loads a vendored viewer (`pdfjs/web/viewer.html`) inside an `<object>` tag using the `app-asset://` protocol.
- [src/renderer/editors/register-editors.ts:238-252](../../../src/renderer/editors/register-editors.ts#L238-L252) — PDF registration block.
- [assets/pdfjs/](../../../assets/pdfjs/) — vendored asset folder (`build/`, `web/`, `LICENSE`).

The pattern:
1. Vendor third-party viewer assets under `/assets/<name>/`.
2. Provide a tiny HTML wrapper (e.g. `web/viewer.html`) loaded via `app-asset://<name>/...`.
3. Editor model extends `EditorModel` (standalone category, not `content-view`).
4. Editor model uses `ContentPipe` so the file can come from disk, an archive, HTTP, etc. — caching to a local temp file when not a plain `FileProvider`.
5. The React component embeds the viewer via `<object data="app-asset://...?file=safe-file://..." type="text/html">`.

### Editor registry mechanics

- [src/renderer/editors/registry.ts](../../../src/renderer/editors/registry.ts) — `editorRegistry.resolve(filePath)` selects the highest-priority editor via `acceptFile()`.
- Editor categories: `"standalone"` (binary / special viewers like PDF, Image) vs `"content-view"` (text-backed renderers like Mermaid, Markdown). DrawIO will be **`"standalone"`** because we hand the raw bytes to the viewer rather than treating it as a Monaco-backed text file.
- `editorType` is a string constant declared in [src/shared/types.ts](../../../src/shared/types.ts) — needs a new value `"drawioFile"`.

### Why standalone, not content-view

Two reasons:
1. The drawio viewer manipulates DOM aggressively and expects ownership of its document; running it in an iframe via `app-asset://` matches the PDF model and keeps it isolated.
2. We want to support the file coming from archives / HTTP sources via `ContentPipe`, with cache-file fallback — same as PDF.

## Implementation plan

### Phase 1 — Asset vendoring

- [ ] **Download `viewer-static.min.js`** from a pinned drawio release tag (e.g. v24.x.x) and place it at `/assets/drawio/js/viewer-static.min.js`. Record version in a `VERSION.txt` next to it.
- [ ] **Vendor LICENSE** — copy drawio's `LICENSE` (Apache-2.0) to `/assets/drawio/LICENSE`.
- [ ] **Vendor any required satellite assets** the viewer pulls in at runtime (shapes, stencils, images). Inspect the viewer's network requests at first run; if it fetches `mxgraph/images/*` or stencil JSON, vendor those too under `/assets/drawio/`. (Open question — see Concerns.)
- [ ] **Create `/assets/drawio/web/viewer.html`** — a minimal HTML wrapper that:
  1. Reads `?file=safe-file://...` from `location.search`.
  2. `fetch()`es the file as text.
  3. Inserts a `<div class="mxgraph" data-mxgraph='{"xml": "..."}'></div>` into `<body>`.
  4. Loads `../js/viewer-static.min.js` and calls `GraphViewer.processElements()`.
  5. Reports load errors with a visible message.

### Phase 2 — Editor model

Files under `/src/renderer/editors/drawio/`:

- [ ] **`DrawioViewer.tsx`** — modeled on [PdfViewer.tsx](../../../src/renderer/editors/pdf/PdfViewer.tsx). Structure:
    - `interface DrawioEditorModelState extends IEditorState { localFilePath?: string; }`
    - `class DrawioEditorModel extends EditorModel<DrawioEditorModelState, void>` with:
        - `noLanguage = true`
        - `private cacheFileCreated = false`
        - `private ensurePipe()` — reconstruct pipe from `filePath` (handles `archive!entry` paths via `ArchiveTransformer`, same as PDF).
        - `async restore()` — call `super.restore()`, set `title` from basename, then either point `localFilePath` at the source path (plain `FileProvider`) or read binary into a temp cache file via `appFs.resolveCachePath(this.id + ".drawio")`.
        - `async dispose()` — delete cache file if `cacheFileCreated`, then `super.dispose()`.
        - `getIcon()` — `<FileIcon path={...} width={12} height={12} />`.
    - `function DrawioViewer({ model })` — renders `PageToolbar` (with file-explorer toggle button matching PDF) + an `<object>` element with `data="app-asset://drawio/web/viewer.html?file=safe-file://..."`.
    - Default export: `EditorModule` with `Editor`, `newEditorModel`, `newEmptyEditorModel`, `newEditorModelFromState`.
- [ ] **`index.ts`** — re-exports `DrawioViewer`, `DrawioEditorModel`, default module.

### Phase 3 — Type and registry wiring

- [ ] **`src/shared/types.ts`** — add `"drawioFile"` to the `EditorType` union.
- [ ] **`src/renderer/editors/register-editors.ts`** — add a new registration block right after the PDF block (~line 252):
    ```ts
    editorRegistry.register({
        id: "drawio-view",
        name: "DrawIO Viewer",
        editorType: "drawioFile",
        category: "standalone",
        acceptFile: (fileName) => {
            if (matchesExtension(fileName, [".drawio"])) return 100;
            return -1;
        },
        loadModule: async () => {
            const module = await import("./drawio/DrawioViewer");
            return module.default;
        },
    });
    ```

### Phase 4 — Verification

- [ ] Open a small single-page `.drawio` file → diagram renders.
- [ ] Open a multi-page `.drawio` file → viewer shows page tabs and switches pages.
- [ ] Open a `.drawio` file with compressed `<diagram>` body → renders correctly (viewer handles decompression).
- [ ] Open a `.drawio` file from inside a `.zip` archive via the navigator → cache-file path used, renders correctly.
- [ ] Reload the app with a `.drawio` page open → page restores, diagram renders again.
- [ ] Toggle file-explorer panel from the toolbar → behaves like PDF viewer.
- [ ] Close the page → cache file (if any) is deleted.

## Concerns / Open questions

1. **Inline vs iframe rendering.** The plan uses the iframe-style `<object data="app-asset://...">` approach (matches PDF). Alternative: load `viewer-static.min.js` via a dynamic `<script>` tag in the React component and call `GraphViewer.createViewerForXmlNode()` directly into a React-managed `<div>`. Inline is lighter-weight and integrates with the host theme, but the viewer manipulates global DOM/CSS and may collide with Persephone's styles. **Recommendation:** start with iframe; revisit if we want toolbar integration (zoom, page nav) within Persephone's chrome.

2. **Satellite assets.** `viewer-static.min.js` may lazy-fetch images (shape stencils, marker icons) from relative paths like `mxgraph/images/*` or absolute URLs to `https://app.diagrams.net/...`. We need to verify and vendor everything required so the viewer works fully offline. Plan: open one diagram with assorted shapes during Phase 1 and watch DevTools Network tab. May need to set `EXPORT_URL` / `RESOURCES_PATH` globals before the script loads.

3. **`.drawio.png` and `.drawio.svg`.** diagrams.net can export diagrams with embedded XML inside PNG/SVG metadata. These are out of scope for v1 — only `.drawio` extension. Note in user docs.

4. **Editing.** This task is **viewer-only**. Editing requires the full diagrams.net editor (~10 MB of assets and complex two-way state sync). Track separately as a future epic if requested.

5. **Multi-page navigation persistence.** The viewer keeps the active page in its own state; we don't persist which page the user was viewing across app restarts. Acceptable for v1.

6. **License attribution.** Apache-2.0 requires preserving the LICENSE and NOTICE files. We'll bundle `LICENSE` under `/assets/drawio/`. Confirm whether the About screen needs a third-party-notices update (see EPIC-025 About migration).

## Acceptance criteria

- [ ] `.drawio` files open in a dedicated viewer page (not Monaco) when double-clicked, drag-dropped, or opened from the navigator.
- [ ] Single-page and multi-page diagrams both render; multi-page shows the viewer's native page tabs.
- [ ] Both plain-XML and compressed `<diagram>` payloads render correctly.
- [ ] Files inside archives (`.zip`, `.tar`, etc.) open via cache-file fallback.
- [ ] No network access required at runtime — fully offline-capable.
- [ ] Page state restores across app restart (file path, title, icon).
- [ ] Closing the page cleans up any cache file.
- [ ] Viewer does not leak global state or stylesheet rules into the host app (verified by opening a `.drawio` page, closing it, and confirming nothing is left behind in the document).
- [ ] LICENSE file present at `/assets/drawio/LICENSE`; vendored version recorded in `VERSION.txt`.

## Files Changed summary

| File | Change |
|------|--------|
| `/assets/drawio/js/viewer-static.min.js` | NEW — vendored from drawio Apache-2.0 release |
| `/assets/drawio/web/viewer.html` | NEW — minimal HTML wrapper that loads file + viewer |
| `/assets/drawio/LICENSE` | NEW — Apache-2.0 from drawio repo |
| `/assets/drawio/VERSION.txt` | NEW — pinned drawio version |
| `/src/renderer/editors/drawio/DrawioViewer.tsx` | NEW — editor model + React component |
| `/src/renderer/editors/drawio/index.ts` | NEW — barrel re-exports |
| `/src/shared/types.ts` | MODIFY — add `"drawioFile"` to `EditorType` |
| `/src/renderer/editors/register-editors.ts` | MODIFY — add registration block after PDF |
| `/doc/active-work.md` | MODIFY — add task entry under Planned (then move to Active when work begins) |
