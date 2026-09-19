# US-1453: Let agents read image-page pixels inline

## Goal

Expose one read-only member on the `image-view` editor facade so an agent can ask `call` for the
loaded image's pixels as a native inline MCP image block, without first knowing a filesystem path
and without the feature writing a file. This document is the implementation plan for that member:
it defines the bounded PNG contract, descriptor/type updates, validation, and completion gate.

## Background

### Existing MCP image transport is already sufficient

`src/main/mcp/tools/call-tools.ts:281-297` contains `callImageResult()`. It accepts both of the
existing renderer result shapes:

```ts
{ type: "image", data: string, mimeType: string, ...metadata }
{ image: { data: string, mimeType: string }, ...metadata }
```

`src/main/mcp/tools/call-tools.ts:304-339` shows `toCallResult()` calling that recognizer and,
when it matches, emitting metadata as a text block followed by a real `{ type: "image" }` MCP
content block. This task therefore must not modify the main-process transport or add an image-page
special case there. The renderer facade should return the first shape directly.

Verified precedents are:

- `src/renderer/scripting/ai-vision/namespaces/clipboard.ts:124-153` — `clipboard.read()` reads
  stored image bytes, returns `{ type: "image", data: image.toString("base64"), mimeType:
  "image/png" }`, and does not return a path.
- `src/renderer/automation/operations.ts:395-413` — browser `takeScreenshot()` asks CDP for
  `format: "png"` and returns the same plain image record.
- `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:475-479` — browser `screenshot()`
  returns that record unchanged, and its help at lines 100-102 documents metadata plus an inline
  image block through `call`.
- `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts:151-165` and `:192-206` — the
  inspector preserves image content blocks in copied tool and prompt snapshots.

`src/renderer/scripting/api-wrapper/ImageEditorFacade.ts:15-24` currently advertises only `id`,
`name`, `source`, save operations, Drawing Editor opening, and clipboard copy. Its implementation
at `:63-89` has no byte-returning member. `src/renderer/api/types/image-editor.d.ts:12-40` has the
same surface. The existing `page.content` contract in
`src/renderer/scripting/api-wrapper/PageWrapper.ts:123-156,229-235` is text-oriented and explicitly
empty for image pages, so it is not an image transport.

### The image editor already has a headless PNG representation

`src/renderer/editors/image/ImageEditor.ts:53-55` identifies the model as `image-view` and
implements `IImageExport`. Its `exportPng()` at `:219-224` reads the runtime `url`, throws
`"No image to export"` when no URL is loaded, and delegates to `rasterToPngBlob()`.

`src/renderer/editors/shared/image-export.ts:9-41` defines that path as view-independent: it loads
the source into an offscreen `Image`, draws at natural dimensions, and encodes a PNG. The comments
at `:18-20` explicitly state that it needs no mounted view and works when the page is not the
active tab. `src/renderer/uikit/ImageViewport/ImageViewportView.ts:67-71,87-90` confirms the
known inactive-page trap: a zero-width container must not be used for fit/zoom calculations. That
trap affects viewport layout only, not `ImageEditor.exportPng()`.

The image state is not guaranteed to have a source at every moment. In
`src/renderer/editors/image/ImageEditor.ts:25-37`, both `filePath` and `url` are optional; the
default state at `:39-44` has neither. `restore()` at `:105-163` can have a pipe while it is still
reading bytes, and only assigns `state.url` at `:127`; the facade's `source` getter at
`src/renderer/scripting/api-wrapper/ImageEditorFacade.ts:63-66` consequently returns `undefined`
when neither path nor runtime URL is available. The new read member must report the existing
no-image error (or an equally explicit loading/unavailable error) rather than write a temporary
file, guess a path, or return an empty image.

### Why this should return PNG pixels

The house pattern for inline visual results is PNG: browser screenshots request PNG, clipboard image
history is stored and returned as PNG, and the image editor's existing `exportPng()` is already the
headless natural-size conversion used by `savePngToFile()` and `copyImageToClipboard()` through
`src/renderer/editors/shared/image-export.ts:57-85`. PNG preserves raster pixels losslessly for
ordinary static raster images and gives the MCP result a stable `mimeType: "image/png"`.

Returning original source bytes would preserve source-format metadata and vector/animation
semantics, but it would diverge from the established screenshot/clipboard contract, require
source-format MIME handling, and may give an agent a format it cannot inspect inline. It is not
needed for this task, whose goal is to let the agent see pixels.

### `call.maxLength` and size behavior

`src/main/mcp/tools/call-tools.ts:155-160,179-185` forwards the caller's `maxLength` to the
resolver. The external resolver in `node_modules/ai-vision/dist/core/resolver.js:20-21,143-150`
passes it to `shapeResult()`. `node_modules/ai-vision/dist/core/result-shaper.js:8,21-37,68-88,113-118`
applies the bound before the main-process `callImageResult()` runs: a structured image record is
not exempt from the text/JSON result budget.

This was measured against the installed resolver, not inferred from the source. With
`maxLength: 200`, a plain `{ type, data, mimeType }` image record resolves as `{}` and the main
process appends only the generic `[truncated: showing 0 of 4 items]` line from
`src/main/mcp/tools/call-tools.ts:330-335`. `truncateObject()` can drop `type`, `data`, and
`mimeType` together, so `callImageResult()` does not match and no MCP image block is emitted. The
default `DEFAULT_MAX_LENGTH = 20_000` at `result-shaper.js:8` admits only roughly 14 KB of binary
image data at a 1.37x base64 expansion, before JSON overhead; most real image pages exceed that.
The generic notice neither identifies the image nor states a required limit, and it cannot restore
bytes already discarded by the resolver.

Two options were considered:

- **(a) Fix the library shaper:** exempt image `data` from the text bound and let the separate MCP
  image content block carry it. This is the structurally correct general fix and would also repair
  browser `screenshot()` and `clipboard.read()`, but the published `ai-vision` package is consumed
  from `node_modules`; this repository cannot make that change inside US-1453.
- **(b) Bound this facade's image contract:** accept a `maxDimension` option, downsample before PNG
  encoding when necessary, and return the applied and original dimensions as metadata. This makes
  the new member usable without changing the transport, although no method-level dimension can
  guarantee fitting every caller-chosen `maxLength`.

**Chosen approach (c): ship (b) in US-1453 and track (a) as the proper AiVision follow-up.** The
new `read(options?: { maxDimension?: number })` uses a default maximum longer side of 2048 px,
which preserves ordinary 1080p/1440p pages whole while bounding pathological source dimensions.
When downsampling occurs, the returned record includes `width`, `height`, `originalWidth`, and
`originalHeight`, so the agent can see exactly what it received. The `$help` text must state the
arithmetic plainly: raise `call.maxLength` to roughly 1.4x the PNG byte size plus result overhead;
an empty or partial object means the bound was too low. It must not claim that `call-tools.ts`
provides a useful image-specific truncation message.

There is no existing byte ceiling to reuse. `image-raster.ts:3-14` encodes at natural size, browser
`Page.captureScreenshot` at `src/renderer/automation/operations.ts:401-409` has no application
cap, and the `1200`-pixel `MAX_DIMENSION` in `src/renderer/editors/draw/drawExport.ts:75,101-107`
is specifically for sizing an image placed inside Excalidraw, not for general image export. The
2048-pixel bound is therefore a new, explicit inline-read contract rather than reuse of the
draw-only placement cap. A future byte-budget/downsample refinement remains separate.

### Scope: Image Editor only

`src/renderer/scripting/api-wrapper/PageWrapper.ts:91-121` maps `image-view` to
`ImageEditorFacade` and `draw-view` to `DrawEditorFacade`. The Drawing Editor already exposes
`exportAsPng()` at `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:9-20,110-126`, but it
returns a PNG data URL and belongs to a different canvas-export contract; converting it into the
same plain image record would be a separate API decision. There is no `PdfEditorFacade`, PDF
editor implementation, or `pdf-view` entry in the current `EDITORS` table at
`src/renderer/editors/register-editors.ts:141-189`; the registry has browser, image, archive, and
video standalone viewers, but no PDF facade to extend.

Recommendation: keep US-1453 limited to `ImageEditorFacade`. Do not re-propose `page.content`, a
generic page screenshot, or a `call-tools.ts` image-page special case. A future unified “show this
page” surface would need to define draw-canvas and PDF/browser semantics together; expanding this
small image-view read contract now would make the task broader without a verified PDF target.

## Implementation Plan

### 1. Add one image read member to the facade

- Update `src/renderer/scripting/api-wrapper/ImageEditorFacade.ts`.
- Import the existing `blobToBuffer` helper from
  `src/renderer/editors/shared/image-export.ts` alongside `copyImageToClipboard` and
  `writePngToFile`.
- Add this member to `IMAGE_EDITOR_MEMBERS`, next to the read-only `source` property and before
  the write/side-effect members:

```ts
// Before
{ name: "source", kind: "property", summary: "The original image path when available, otherwise its loaded runtime URL; undefined when no image is loaded." },
{ name: "savePngToFile", kind: "method", ... },

// After
{ name: "source", kind: "property", summary: "The original image path when available, otherwise its loaded runtime URL; undefined when no image is loaded." },
{ name: "read", kind: "method", signature: "read(options?: { maxDimension?: number }): Promise<ImageReadResult>", summary: "Read the loaded image as a bounded PNG image result for inline MCP display; reports applied and original dimensions." },
{ name: "savePngToFile", kind: "method", ... },
```

- Add an internal image-result type for the facade's plain return value:
  `{ type: "image", data: string, mimeType: "image/png", width: number, height: number,
  originalWidth: number, originalHeight: number }`.
- Implement `read(options?)` by validating an optional positive integer `maxDimension`, obtaining
  the loaded runtime URL, rasterising it through a shared helper, and converting the returned blob
  with `blobToBuffer()`. The helper must draw at natural size when the longer side is at most the
  effective limit and draw to aspect-ratio-preserving bounded dimensions otherwise. Return the
  base64 PNG plus both applied and original dimensions.
- Refactor `src/renderer/editors/shared/image-export.ts` so the existing natural-size
  `rasterToPngBlob()` behavior remains unchanged for saves/copy, while a richer helper returns
  `{ blob, width, height, originalWidth, originalHeight }` for this read path. Keep the
  `ImageEditor.exportPng()` Blob contract unchanged; its existing no-URL error remains the loading
  failure contract.
- Do not activate the page, inspect viewport dimensions, write a file, return a path, or add a
  `caution` entry. This is a read-only member; invalid `maxDimension`, no-image/load, and raster
  encoding failures are explicit errors.
- Extend `IMAGE_EDITOR_HELP` with the usage and size contract: call `read()` after narrowing
  `editor.id` to `image-view`; it returns a PNG through the existing inline MCP image result path,
  defaults to a 2048-pixel longer side, reports dimensions, supports inactive pages, and fails
  when not yet loaded. Explain that `maxLength` is applied before image conversion: use roughly
  1.4x the PNG byte size plus overhead, and an empty/partial result means the bound was too low.

### 2. Extend the script-facing image-editor type

Update `src/renderer/api/types/image-editor.d.ts` with the same method and JSDoc. The before/after
contract is:

```ts
// Before
readonly source?: string;
readonly elements: readonly { /* ... */ }[];

// After
readonly source?: string;
/** Read the loaded image as a bounded PNG result for inline MCP display. */
read(options?: { maxDimension?: number }): Promise<{
    type: "image";
    data: string;
    mimeType: "image/png";
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
}>;
readonly elements: readonly { /* ... */ }[];
```

Keep the runtime and declaration shapes aligned. Do not add a generic binary type or expose the
main-process `McpContentBlock` type in renderer declarations. `assets/editor-types/image-editor.d.ts`
is the generated Monaco copy; `doc/standards/editor-guide.md:354-358` and
`doc/architecture/folder-structure.md:28-30` require it to be refreshed by the Vite editor-types
plugin rather than hand-edited.

### 3. Preserve the existing transport and scope

- Leave `src/main/mcp/tools/call-tools.ts` unchanged. The returned record already matches
  `callImageResult()` and `toCallResult()`.
- Leave `src/renderer/editors/image/ImageEditor.ts` unchanged unless implementation reveals that
  the existing runtime URL access cannot support the bounded helper. Its existing headless
  `exportPng()` remains the natural-size Blob contract for save/copy callers.
- Do not add the member to `DrawEditorFacade`, any PDF surface, `PageWrapper.content`, or a generic
  screenshot route.

### 4. Verify the completed implementation

- Discover the member through `pages[i].editor` after narrowing `editor.id === "image-view"` and
  confirm the descriptor contains `read` without a `caution` field.
- Call `read()` on an active local raster image and confirm the MCP response contains metadata text
  plus a native image block with `mimeType: "image/png"`.
- Call it on an inactive image page and confirm it returns the same pixels at the effective
  dimensions; verify no viewport activation or 0x0 layout dependency was introduced. For an image whose longer
  side exceeds 2048 px, confirm the returned metadata reports bounded `width`/`height` and the
  original dimensions.
- Exercise a URL/blob-backed image and a not-yet-loaded/no-URL editor state; the latter must return
  a clear error and never write a file.
- Call with the default and an intentionally too-small `maxLength`, then with a sufficiently large
  value, confirming the measured empty/partial-object behavior and that the help accurately
  describes the arithmetic and limitation.
- Confirm existing save, original-save, drawing, clipboard, browser screenshot, and page-content
  behavior is unchanged.

## Concerns

### Resolved recommendations

- **Result format:** Use a PNG re-encode, bounded to the requested maximum dimension. This follows
  browser screenshot, clipboard image, and existing image-export behavior. It exposes pixels
  consistently but intentionally does not preserve original-format metadata, vector form, or
  animation.
- **Size:** Use `read(options?: { maxDimension?: number })` with a 2048-pixel default, preserve
  aspect ratio, and report applied/original dimensions. This bounds pathological images while
  keeping ordinary 1080p/1440p pages whole. `call.maxLength` still shapes the record first: raise
  it to roughly 1.4x the PNG bytes plus overhead; an empty or partial result means it was too low.
  The generic item-count notice is not an image-specific recovery message.
- **Member name/signature:** Use `read(options?: { maxDimension?: number })` because
  `clipboard.read()` is the closest read precedent and `read()` is not redundant with the existing
  `source` property. Its plain result adds `width`, `height`, `originalWidth`, and `originalHeight`
  metadata. It is read-only, so no `caution` metadata is needed. The descriptor is automatically
  included because `aiVision.members` spreads `IMAGE_EDITOR_MEMBERS` at `ImageEditorFacade.ts:55`.
- **Inactive/loading state:** The implementation must use the shared headless raster path, not
  viewport layout or a mounted `<img>`. Inactive pages are supported by the same offscreen export
  machinery used by `ImageEditor.exportPng()`. A missing runtime URL during default state or restore
  is an explicit no-image/load failure, not an empty or path-based result.
- **PDF/draw scope:** Keep both out of scope. Draw has a separate PNG data-URL export and PDF has
  no current editor facade/registry target, so neither can be added consistently within this one
  image-editor member task.
- **Existing image precedents and size:** `clipboard.read()` and browser `screenshot()` remain
  verified precedents for the plain result shape only. They are subject to the same resolver
  shaping and can also lose their image record under a low `maxLength`; there is no image bypass in
  `resolver.js` or `result-shaper.js`. The bounded `read()` contract fixes only the new image-page
  member in this task. The library-side fix tracked below would repair all three surfaces together.

### Open risks to carry into implementation

- PNG base64 can exceed the resolver's default `maxLength` quickly. The feature bounds dimensions
  but still depends on the caller raising the limit; implementation verification must ensure the
  help text describes the measured empty/partial-object failure and never implies that a partial
  image is usable.
- PNG rasterization can be expensive for very large source dimensions. The 2048-pixel default bounds
  the canvas allocation, while callers can choose a smaller or larger positive limit explicitly.
- For an image that is still restoring, `filePath` or a pipe may exist before `state.url` is set.
  The chosen headless raster route intentionally treats that state as unavailable until the runtime
  image is loaded; it must not fall back to an unrequested disk write.

## Acceptance Criteria

- [ ] `ImageEditorFacade` advertises exactly one new read-only member named `read` in
      `IMAGE_EDITOR_MEMBERS`, with the `maxDimension` option, precise result metadata, and no
      `caution` field.
- [ ] `read()` returns `{ type: "image", data: <base64 PNG>, mimeType: "image/png", width,
      height, originalWidth, originalHeight }` through the shared bounded raster path and writes no
      file.
- [ ] `src/renderer/api/types/image-editor.d.ts` documents the same `read()` result contract.
- [ ] The MCP transport files remain unchanged; `callImageResult()` receives the facade's existing
      recognized shape and produces metadata text plus an inline MCP image block.
- [ ] The method works for inactive pages without depending on viewport/container dimensions,
      downscales images above the 2048-pixel default while preserving aspect ratio, reports applied
      and original dimensions, and fails clearly when no runtime image is loaded.
- [ ] `$help` documents PNG re-encoding, inactive-page behavior, no-image failure, the 2048-pixel
      default, and the arithmetic/empty-or-partial-object limitation of `call.maxLength`.
- [ ] The implementation passes `npm run typecheck`, `npm run lint`, and `npm run build-prod`.
      No unit tests are added or required, and no commit is created by the agent.
- [ ] The draw editor, any PDF surface, generic page screenshot, `page.content`, and
      `call-tools.ts` remain out of scope for this task.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1453-image-editor-read-member/README.md` | This source-verified planning document. |
| `doc/active-work.md` | Add the linked US-1453 entry under Active → `*(no epic)*`, preserving US-1452. |
| `src/renderer/scripting/api-wrapper/ImageEditorFacade.ts` | Add the `read()` descriptor, help text, and headless PNG result implementation. |
| `src/renderer/api/types/image-editor.d.ts` | Add the script-facing `read()` declaration and result JSDoc. |
| `src/renderer/editors/shared/image-export.ts` | Add bounded rasterisation with applied/original dimension metadata while preserving the existing natural-size Blob helper. |
| `doc/tasks/backlog.md` | Record the follow-up to make AiVision result shaping image-aware so all inline image surfaces bypass text-size truncation. |

Files that need **no changes** for US-1453: `src/main/mcp/tools/call-tools.ts` (already converts the
recognized image record), `src/renderer/editors/image/ImageEditor.ts` (already has headless natural-
size `exportPng()`), `src/renderer/uikit/ImageViewport/ImageViewportView.ts` (its
0x0 inactive-page guard is layout-only), `src/renderer/scripting/api-wrapper/PageWrapper.ts`,
`src/renderer/scripting/api-wrapper/DrawEditorFacade.ts`, `assets/editor-types/image-editor.d.ts`
(generated from the source declaration), the editor registry, and any PDF files
(there is no current PDF facade/editor target). No test file, MCP transport file, or generic page
screenshot surface should be added or modified.
