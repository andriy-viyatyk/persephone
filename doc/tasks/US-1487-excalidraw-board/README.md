# US-1487 — The Excalidraw board

**Status:** Planned · **Epic:** [EPIC-109: Bundled boards and the Excalidraw board](../../epics/EPIC-109.md) · **Depends on:** [US-1483: Bundled board registry and discovery](../US-1483-bundled-board-registry/README.md), [US-1484: Stable identity for bundled boards across install paths](../US-1484-bundled-board-identity/README.md), [US-1485: Built-in tab presentation and the Disable action](../US-1485-bundled-board-disable/README.md), [US-1486: The board's prebuilt `lib/`, generated once and committed](../US-1486-board-prebuilt-lib/README.md)

## Goal

Turn the bundled Excalidraw smoke page into the real `.excalidraw` content-host editor. It must
load and save the host's Excalidraw JSON, win default file-editor resolution over the still-registered
built-in `draw-view`, expose the existing `DrawEditorFacade` behavior through the existing board
`aiVision` transport, and leave undo owned by Excalidraw.

This is an investigation and implementation plan only. No implementation, test harness, app run, or
generated-library rebuild belongs to this task.

## Background

### Binding epic decisions and tracking

EPIC-109 keeps bundled boards app-owned and location-trusted: the shipped board is not copied into
the user's board directory, does not need a trust-file entry or trust dialog, and is served from its
real installed root. [`EPIC-109.md:56-76`](../../epics/EPIC-109.md#L56-L76)
The board is presented under Tools & Editors → Built-in, not Registered boards, and its disable action
removes its registrations. [`EPIC-109.md:78-93`](../../epics/EPIC-109.md#L78-L93)

The built-in `draw-view` remains registered throughout EPIC-109 and is the fallback after disabling
the bundled board. [`EPIC-109.md:135-154`](../../epics/EPIC-109.md#L135-L154)
The Excalidraw board must use `editorPriority: 60`, not the roadmap's 50: `draw-view` claims
`.excalidraw` at 50 and the custom-editor registry uses strict `>` comparison, so a tie would leave
the built-in as the default. [`EPIC-109.md:156-162`](../../epics/EPIC-109.md#L156-L162)

The committed `assets/boards/excalidraw/lib/` tree is generated manually by
`scripts/build-board-lib.mjs`; no Persephone build rebuilds it. D9 permits rerunning it only when the
Excalidraw dependency set genuinely changes. The generated import map in `index.html` must remain
between its existing `<!-- import-map:start -->` and `<!-- import-map:end -->` markers and must not be
hand-edited. [`EPIC-109.md:173-210`](../../epics/EPIC-109.md#L173-L210)

The active-work dashboard already has the required US-1487 entry at
[`active-work.md:36-45`](../../active-work.md#L36-L45), so it needs no change. The EPIC-109 Linked
Tasks row is currently unlinked and will be changed to point at this document.

### Current smoke board

`assets/boards/excalidraw/board-manifest.json` currently declares only `schemaVersion`, descriptive
metadata, and `standalone: true`. `assets/boards/excalidraw/index.html` sets
`window.EXCALIDRAW_ASSET_PATH = "./lib/"`, imports the generated local vendor entry, and renders
`Excalidraw` with `initialData: {}` and `viewModeEnabled: true`.

The manifest parser supports `fileMasks`, `capabilities`, `editorPriority`, and the three editor
kinds. [`board-manifest.ts:48-56`](../../../src/renderer/editors/board/board-manifest.ts#L48-L56)
[`board-manifest.ts:88-105`](../../../src/renderer/editors/board/board-manifest.ts#L88-L105)
`isBoardStandalone()` first honors an explicit boolean and otherwise derives standalone from the
absence of file masks; a board with masks defaults to `false` because a file-bound board must opt in.
Excalidraw is explicitly both file-associated and openable without a file, so it must keep
`standalone: true`. [`board-manifest.ts:652-661`](../../../src/renderer/editors/board/board-manifest.ts#L652-L661)
US-1485's bundled creatable row already branches on `editorKind === "content-host"` and calls
`pagesModel.addBundledBoardPage(board.root, "json", "untitled.excalidraw")`, proving that this board
is created without a source file. [`tools-editors-registry.ts:214-241`](../../../src/renderer/ui/sidebar/tools-editors-registry.ts#L214-L241)
EPIC-109 D3 also requires the board to take over the Built-in row and remain pinnable.
[`EPIC-109.md:78-93`](../../epics/EPIC-109.md#L78-L93)

Removing the explicit opt-in would make `boardUsageGroup()` report `file-viewer` rather than
`file-editor`—a false description of this board. [`board-manifest.ts:665-669`](../../../src/renderer/editors/board/board-manifest.ts#L665-L669)
The current blast
radius is nil because the usage group is consumed only by `TrustedBoardsListView` and `SearchBoardsTab`,
while bundled boards do not enter Registered boards and the Built-in creatable row does not gate on
it. [`TrustedBoardsListView.ts:161-226`](../../../src/renderer/ui/sidebar/TrustedBoardsListView.ts#L161-L226)
[`SearchBoardsTab.ts:33`](../../../src/renderer/editors/tools-hub/SearchBoardsTab.ts#L33)

### Content-host lifecycle and exact bridge calls

`PagesLifecycleModel.buildEditorById()` selects `BoardContentEditorModel` when the normalized
manifest kind is `content-host`, initializes it with the board root and file path, and adopts a
`TextFileModel` host. `addBundledBoardPage()` rejects a bundled board that does not construct a
content host. [`PagesLifecycleModel.ts:130-194`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L130-L194)
[`PagesLifecycleModel.ts:250-275`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L250-L275)

The board page uses the runtime content-host API on `window.persephone.host`:

```js
const content = await persephone.host.getContent();
const unsubscribe = persephone.host.onContentChange((content, language) => { ... });
persephone.host.setContent(serializedExcalidrawJson);
persephone.host.save();
const language = await persephone.host.getLanguage();
```

`getContent()` and `getLanguage()` wait for the host handshake and return the current snapshot.
`onContentChange()` receives later renderer-to-board snapshots and returns an unsubscribe function.
`setContent()` posts `{ __persephone: "board:setContent", content }`, updates the host replica, and
does not invoke the board's own change callback. `save()` posts
`{ __persephone: "board:save" }`; Ctrl+S is also handled by the host editor. These calls are
implemented in [`src/board-shim.ts:1386-1468`](../../../src/board-shim.ts#L1386-L1468).

The renderer receives `board:setContent` and calls
`BoardContentEditorModel.hostChangeContent(content)`, which delegates to
`TextFileModel.changeContent(content, true)`. `board:save` delegates to `hostSave()` and
`TextFileModel.saveFile()`. Host snapshots are pushed as `host:content` and subsequent snapshots
reach `onContentChange`. [`BoardWebview.ts:266-331`](../../../src/renderer/editors/board/BoardWebview.ts#L266-L331)
[`BoardWebview.ts:371-378`](../../../src/renderer/editors/board/BoardWebview.ts#L371-L378)
[`BoardWebview.ts:427-450`](../../../src/renderer/editors/board/BoardWebview.ts#L427-L450)

`BoardContentEditorModel` owns the shared host's dirty state, save state, host transfer, and
auto-save cache. Its `modified` getter, `saveState()`, `hostChangeContent()`, and `hostSave()` are
the model-side contract. [`BoardContentEditorModel.ts:185-242`](../../../src/renderer/editors/board/BoardContentEditorModel.ts#L185-L242)
The board must therefore parse `getContent()` on startup, subscribe for external changes, and send
every user edit through `setContent()`. It must not read the file path directly or implement a
second file writer. The Excalidraw on-change path should retain the existing draw editor's 500 ms
debounce and content/file fingerprinting behavior so selection and view-only state do not dirty the
host unnecessarily; the existing implementation is [`DrawBodyView.ts:240-249`](../../../src/renderer/editors/draw/DrawBodyView.ts#L240-L249)
and [`DrawEditor.ts:158-177`](../../../src/renderer/editors/draw/DrawEditor.ts#L158-L177).

The declaration file is a legacy snapshot and its `PersephoneHostApi` currently declares only
`streamUrl()`, while the runtime exposes the content methods above. [`board-api.d.ts:7-12`](../../../src/renderer/editors/board/board-api.d.ts#L7-L12)
[`board-api.d.ts:287-290`](../../../src/renderer/editors/board/board-api.d.ts#L287-L290)
The bundled page is plain browser JavaScript, so this omission does not block US-1487 or require a
renderer bridge change. The implementation must follow `src/board-shim.ts` and the content-host model,
not infer that the declaration is exhaustive. A future typed board authoring change may extend the
declaration separately; it is not part of this task's file set.

### Footer status

`persephone.setStatusText(text)` is the content-host footer status API. It is meaningful from the
main board view; `""` clears it and it is a visual no-op for a plain board. The shim posts
`{ __persephone: "board:setStatusText", statusText }`. [`board-api.d.ts:385-389`](../../../src/renderer/editors/board/board-api.d.ts#L385-L389)
[`src/board-shim.ts:1169-1182`](../../../src/board-shim.ts#L1169-L1182)

`BoardEditorView` creates `ContentHostFooterView` for a content host, binds the model's transient
`statusText`, and places the board's status contribution in the footer. The model does not persist
or restore the status text. [`BoardEditorView.ts:117-142`](../../../src/renderer/editors/board/BoardEditorView.ts#L117-L142)
[`BoardEditorModel.ts:120-124`](../../../src/renderer/editors/board/BoardEditorModel.ts#L120-L124)
[`BoardEditorModel.ts:665-678`](../../../src/renderer/editors/board/BoardEditorModel.ts#L665-L678)
The Excalidraw board should use this API for a transient count/status only; it must not try to draw a
second footer or persist status in its Excalidraw JSON.

### `.excalidraw` round-trip contract

The built-in `DrawEditor.parseContent()` accepts empty content as an empty scene and otherwise parses
the JSON fields `elements`, `appState`, and `files`, defaulting missing fields to empty values. It
does not provide a second board-specific schema. [`DrawEditor.ts:139-155`](../../../src/renderer/editors/draw/DrawEditor.ts#L139-L155)

The compatible saved document is the vendor serializer's local format:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "...",
  "elements": [],
  "appState": {},
  "files": {
    "file-id": {
      "id": "file-id",
      "mimeType": "image/png",
      "dataURL": "data:image/png;base64,...",
      "created": 0
    }
  }
}
```

The board must call the vendor `serializeAsJSON(elements, appState, files, "local")` rather than
hand-assembling or stripping this structure. In the vendor implementation, local serialization
emits `type: "excalidraw"`, the current Excalidraw version (2), a source, cleaned elements and
appState, and filters `files` to binary files referenced by non-deleted image elements. The draw
editor imports that serializer and uses it before `writeToHost`.
[`DrawEditor.ts:7`](../../../src/renderer/editors/draw/DrawEditor.ts#L7)
[`DrawEditor.ts:175-176`](../../../src/renderer/editors/draw/DrawEditor.ts#L175-L176)
The vendor implementation is in [`node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js`](../../../node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js#L17918-L17940).

On load, parse the host JSON, pass its `elements`, `appState`, and `files` into Excalidraw's
`initialData`/scene update, and retain the complete `files` map. The board loader must be at least as
permissive as `DrawEditor.parseContent()`: empty or whitespace content is an empty scene, and missing
`elements`, `appState`, or `files` default to `[]`, `{}`, and `{}` rather than throwing.
[`DrawEditor.ts:139-155`](../../../src/renderer/editors/draw/DrawEditor.ts#L139-L155)

The compatibility checks are asymmetric. `draw-view` ignores `type`, `version`, and `source` after
parsing, but Excalidraw's loader validates the `type: "excalidraw"` shape when opening a
draw-view-saved file in the board and restores `data.files`. The board must still emit those vendor
fields through `serializeAsJSON`, so the reverse direction remains valid; the actual acceptance test
is a two-way round-trip with an embedded image, not merely field presence.
[`node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js`](../../../node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js#L24685-L24730)
This is the compatibility requirement while D6 keeps `draw-view` registered.

### Coexistence and editor switching

The built-in matcher claims `.excalidraw` at 50 and offers `draw-view` as a switch option. [`editor-matchers.ts:135-140`](../../../src/renderer/editors/base/editor-matchers.ts#L135-L140)
The custom registry's file resolver accepts a board content host and only replaces the built-in
winner when the board priority is strictly greater. [`custom-editor-registry.ts:517-547`](../../../src/renderer/editors/board/custom-editor-registry.ts#L517-L547)
With the planned board priority 60, an existing persisted `.excalidraw` page resolves to the board
when it is enabled and trusted. If the board is disabled, the persisted board editor cannot remain
the active handler and the still-registered `draw-view` is the fallback required by D6.

While the board is active, `BoardContentEditorModel.findCompatibleEditors()` calls
`editorRegistry.findEditorsAccepting(host)` and appends the board editor id. For a `.excalidraw`
host this keeps `draw-view` in the editor-switch options, allowing a user to switch without losing
the shared host; switching transfers the same `TextFileModel` rather than reloading content.
[`BoardContentEditorModel.ts:68-83`](../../../src/renderer/editors/board/BoardContentEditorModel.ts#L68-L83)
This is distinct from default resolution: the board wins the default at 60, but `draw-view` remains
available as an explicit switch option.

### `editorKind: "content-host"` validity

The manifest's normalized editor kind selects the content-host construction branch. A missing or
unknown kind normalizes to `simple`; that board receives a file path but has no content host, so
`persephone.host.getContent()`, `setContent()`, and save cannot provide the required file lifecycle.
Declaring `content-host` without the registry/lifecycle construction would fail the bundled-board
path's explicit `contentHost` check with `Bundled board did not create a content host`.
[`PagesLifecycleModel.ts:130-194`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L130-L194)
[`PagesLifecycleModel.ts:250-275`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L250-L275)

### aiVision model and facade compatibility

`DrawEditorFacade` exposes these observable members:

```ts
addImage(
    dataUrl: string,
    options?: { x?: number; y?: number; maxDimension?: number },
): Promise<void>;
exportAsSvg(): Promise<string>;
exportAsPng(options?: { scale?: number }): Promise<string>;
readonly elementCount: number;
readonly editorIsMounted: boolean;
```

`addImage` defaults the image position to `(250, 120)`, caps dimensions by `maxDimension`, stores a
PNG file record with a generated id, and adds an image element. `elementCount` is the current editor
element-array length. `editorIsMounted` reflects whether the Excalidraw imperative API is mounted.
`exportAsSvg` returns SVG `outerHTML`; `exportAsPng` returns a PNG data URL, defaulting its export
scale to 2. The existing facade's exact implementation and errors are in
[`DrawEditorFacade.ts:1-127`](../../../src/renderer/scripting/api-wrapper/DrawEditorFacade.ts#L1-L127).
The board implementation must preserve these semantics while calling the vendor API directly.

The board does not need a new bridge. The main frame declares a serializable model and calls
`persephone.aiVision.expose(root)`. The current transport publishes the remote's schema/shape with
`{ __persephone: "board:aiVision" }`, accepts only the trusted current main frame, and routes model
requests through the existing board request channel. [`src/board-shim.ts:637-704`](../../../src/board-shim.ts#L637-L704)
[`BoardEditorModel.ts:171-345`](../../../src/renderer/editors/board/BoardEditorModel.ts#L171-L345)
[`BoardWebview.ts:495-530`](../../../src/renderer/editors/board/BoardWebview.ts#L495-L530)

The board-side declaration pattern is documented in the board template: create element declarations,
call `persephone.aiVision.createElements(declarations)`, put the declarations and generated members
on the model, provide `elements.provide`, and expose the model once from the main frame. Refresh the
remote if the declared shape or metadata changes. [`assets/board-template/CLAUDE.md:597-652`](../../../assets/board-template/CLAUDE.md#L597-L652)
No working `aiVision` example was found in `.persephone/boards/` or `assets/demo-board/`; the template
pattern and transport are the verified references.

The Excalidraw model should therefore expose a stable `aiVision` object with a board kind/summary,
members for `addImage`, `exportAsSvg`, `exportAsPng`, `elementCount`, and `editorIsMounted`, and
generated element declarations only if the implementation needs callable DOM elements. The members
must use the same method/property semantics as the facade; no second message protocol or React-island
facade is permitted. The remote should be refreshed after scene metadata changes, not on every normal
scene edit unless the exposed shape itself changes.

### Export availability and payload boundary

The board cannot import `src/renderer/editors/draw/drawExport.ts` because that is renderer source.
The generated vendor entry already exports `exportToSvg`, `exportToBlob`, `serializeAsJSON`,
`convertToExcalidrawElements`, and `MIME_TYPES`; these exports are reachable through the page's
existing direct `./lib/index.js` module import. No import-map change or generator rerun is required.
[`assets/boards/excalidraw/lib/index.js:1`](../../../assets/boards/excalidraw/lib/index.js#L1)
The board should reproduce `drawExport.ts` by calling:

```js
await exportToSvg({
    elements,
    appState: { ...appState, exportBackground: true,
        exportWithDarkMode: appState.theme === "dark" },
    files,
});

await exportToBlob({
    elements,
    appState: { ...appState, exportBackground: true,
        exportWithDarkMode: appState.theme === "dark", exportScale: scale },
    files,
    mimeType: "image/png",
});
```

Return SVG `outerHTML`; convert the PNG blob with `FileReader.readAsDataURL()` and return the data
URL. This matches [`drawExport.ts:89-155`](../../../src/renderer/editors/draw/drawExport.ts#L89-L155)
and the facade's PNG error behavior. `exportAsPng` therefore sends a potentially large string across
the board aiVision bridge. EPIC-108 D7 caps board-bound inline structured-clone payloads at 8 MiB and
uses `payload-too-large` above that limit; its handle store is deferred. [`EPIC-108.md:281-318`](../../epics/EPIC-108.md#L281-L318)
US-1488 owns measuring the Excalidraw image-edit payload and p95 clone cost against that cap. US-1487
must preserve the data-URL facade contract and record the interaction, but must not perform US-1488's
measurement or invent a data-handle path.

## Implementation Plan

### 1. Update the bundled-board manifest

Edit `assets/boards/excalidraw/board-manifest.json` as follows:

```json
// Before
{
  "schemaVersion": 1,
  "name": "Excalidraw Smoke Board",
  "description": "A read-only smoke board for the bundled Excalidraw library.",
  "author": "Persephone",
  "standalone": true
}

// After
{
  "schemaVersion": 1,
  "name": "Excalidraw",
  "description": "The bundled Excalidraw editor.",
  "author": "Persephone",
  "permissions": ["capabilities"],
  "capabilities": [
    { "id": "image.edit", "version": 1, "priority": 60, "title": "Edit image" },
    { "id": "diagram.edit", "version": 1, "priority": 60, "title": "Edit diagram" }
  ],
  "fileMasks": ["*.excalidraw"],
  "editorKind": "content-host",
  "editorPriority": 60,
  "standalone": true
}
```

The capability priority is explicit so these board handlers outrank the platform handlers, which are
seeded at priority 50; capability candidates compare higher priority first. [`capabilities.ts:141-150`](../../../src/renderer/api/capabilities.ts#L141-L150)
[`capabilities.ts:163-204`](../../../src/renderer/api/capabilities.ts#L163-L204)
The `permissions` entry is disclosure only; it does not gate capability registration. The capability
array is the functional declaration consumed by the registry. `standalone: true` is an explicit opt-in
because the board is also creatable and pinnable with no file. Omitting it would currently have no
observable effect in the Registered-boards or Built-in views, but would misclassify the board's usage
group.

### 2. Replace the smoke bootstrap with the content-host editor

Edit the module script in `assets/boards/excalidraw/index.html`. Keep the generated import-map block
byte-for-byte under its existing markers and keep the local asset-path assignment before importing
the vendor module. Remove `viewModeEnabled` so Excalidraw renders its full toolbar.

```js
// Before
root.render(React.createElement(Excalidraw, {
    initialData: {},
    viewModeEnabled: true,
}));

// After (behavioral outline; exact vendor types come from ./lib/index.js)
const content = await persephone.host.getContent();
const scene = parseExcalidrawContent(content);
const unsubscribe = persephone.host.onContentChange((nextContent) => {
    updateScene(parseExcalidrawContent(nextContent));
});

root.render(React.createElement(Excalidraw, {
    initialData: scene,
    onChange: scheduleHostWrite,
}));
```

The implementation must maintain the current elements/appState/files scene in board state, serialize
with `serializeAsJSON(..., "local")` after a debounced Excalidraw change, and call `setContent()`.
External host snapshots must replace the scene without echoing them back. The unsubscribe must be
released when the board page is torn down if the bootstrap adds any board-local teardown path.
Call `setStatusText()` only for a transient main-view footer status if the board exposes one; do not
persist it in the document.

### 3. Implement the facade-compatible aiVision model

In the same board bootstrap, construct a stable model before calling `persephone.aiVision.expose()`.
Expose the required callable methods and live properties with the exact facade signatures. Use the
vendor `convertToExcalidrawElements` and `MIME_TYPES` for image insertion, generate the image file
record and element dimensions with the facade's defaults, and update the live Excalidraw scene.
Use vendor `exportToSvg`/`exportToBlob` with the `drawExport.ts` appState flags, then return
`outerHTML`/PNG data URL as described above.

`elementCount` and `editorIsMounted` must be observable properties, not one-time boot constants.
All Excalidraw undo/redo calls remain inside the Excalidraw instance; no `persephone` undo API or
platform undo action is wired.

Declare/expose the model from the main board frame only. Do not add renderer message listeners,
ports, or a new bridge. The existing board transport validates and routes the exposed model.

### 4. Update epic tracking

Change only the US-1487 row in `doc/epics/EPIC-109.md`:

```md
<!-- Before -->
| US-1487 | The Excalidraw board | Planned |

<!-- After -->
| [US-1487](../tasks/US-1487-excalidraw-board/README.md) | The Excalidraw board | Planned |
```

Do not change `doc/active-work.md`; its Active EPIC-109 list already links this task.

## Concerns

- The public `board-api.d.ts` host declaration is incomplete: it exposes only `streamUrl()` even
  though the runtime shim exposes the five content-host methods required here. This is a verified
  declaration drift, not a missing runtime feature. The plain JavaScript bundled page can use the
  runtime API without changing the renderer or inventing a bridge; a future typed-board task may
  update the declaration.
- `exportAsPng` returns a data URL across the existing aiVision bridge. The 8 MiB board-bound cap is
  a real boundary from EPIC-108 D7; measuring ordinary Excalidraw payloads belongs exclusively to
  US-1488. If the later measurement crosses the cap, that is a follow-up data-handle task rather
  than a silent format or transport change in US-1487.
- There is no local working aiVision example in `.persephone/boards/` or `assets/demo-board/`. The
  board-template declaration pattern and the existing `board-shim.ts`/`BoardEditorModel.ts`
  transport are sufficient, verified references. No new transport is justified.
- The generated import map and all files under `assets/boards/excalidraw/lib/` are out of scope.
  Rerunning `npm run build-board-lib` would be justified only by a genuinely changed dependency
  set, which this task does not require because the required vendor exports are already present.
- Default resolution and explicit switching intentionally differ: priority 60 makes the board the
  default while `draw-view` stays in switch options and remains the fallback when the board is
  disabled. Acceptance must verify both paths and a round-trip file opened by each editor.

## Acceptance Criteria

1. `assets/boards/excalidraw/board-manifest.json` declares `fileMasks: ["*.excalidraw"]`,
   `editorKind: "content-host"`, `editorPriority: 60`, both capability ids at priority 60, and
   explicit `standalone: true` so the board remains creatable and pinnable without a file.
2. The board opens an existing `.excalidraw` host snapshot, displays the full Excalidraw toolbar,
   marks edits dirty through `setContent()`, and saves through the content-host lifecycle.
3. A board-saved file opens in `draw-view`, and a built-in-saved file opens in the board, in both
   directions with an embedded image preserved. The board accepts empty content and missing optional
   scene fields using the same defaults as `DrawEditor.parseContent()`, while still emitting the
   vendor serializer's `type`, `version`, `source`, `elements`, `appState`, and `files` fields.
4. With the board enabled, an existing `.excalidraw` page resolves to the board at priority 60;
   `draw-view` remains an explicit editor-switch option. With the board disabled, `draw-view` remains
   usable as the fallback.
5. The board exposes `addImage`, `exportAsSvg`, `exportAsPng`, `elementCount`, and
   `editorIsMounted` through `persephone.aiVision.expose()` with the `DrawEditorFacade` observable
   signatures and semantics. Exports use the vendor functions reachable from `lib/index.js`.
6. The board does not add a bridge, use `editors/draw/drawExport.ts`, wire Persephone undo, touch
   generated vendor output, or measure the payload threshold assigned to US-1488.
7. EPIC-109's Linked Tasks table links US-1487 to this document, and the existing dashboard entry
   remains valid.

## Files Changed Summary

| File | Change |
|---|---|
| `assets/boards/excalidraw/board-manifest.json` | Add content-host file association, editor priority, capability declarations, and retain explicit standalone opt-in. |
| `assets/boards/excalidraw/index.html` | Replace smoke bootstrap with content loading/saving, full-toolbar Excalidraw scene handling, vendor exports, and aiVision exposure; preserve generated import-map markers/block. |
| `doc/epics/EPIC-109.md` | Link the US-1487 Linked Tasks row to this document. |
| `doc/active-work.md` | No change; the required dashboard entry already exists. |
| `assets/boards/excalidraw/lib/**` | No change; generated and committed per D9. |
| `scripts/build-board-lib.mjs` | No change; no dependency set change was found. |
| `src/renderer/editors/board/board-api.d.ts` | No change in this task; its incomplete host declaration is recorded as contract drift, while the runtime shim is authoritative for this plain-JavaScript page. |
| `src/renderer/**`, `src/board-shim.ts` | No change; existing content-host, footer, aiVision, and editor-switch transports provide the required runtime. |

## Verification status

Live verification against a real `.excalidraw` file, 2026-09-20, in the running app.

| Check | Result |
|---|---|
| File resolution | `us1487-test.excalidraw` opens as `board-editor:…\assets\boards\excalidraw`, not `draw-view` — priority 60 beats 50 |
| Board state | `renderState: "bundled"`, `frameReady: true`, no trust dialog |
| Mount | `rootChildren: 1`, `excalidrawNodes: 1`, `canvases: 2` |
| Full toolbar | 18 toolbar buttons; the Shapes region with every drawing tool is present in the snapshot — `viewModeEnabled` is gone |
| Content load | `elementCount: 1` — the rectangle came from the file, not an empty scene |
| aiVision surface | `editor.app` reports `kind: "DrawEditor"`, `id`, `name`, `elementCount`, `editorIsMounted`, `addImage`, `exportAsSvg`, `exportAsPng` — identical to `DrawEditorFacade` |
| `exportAsSvg()` | returns valid SVG carrying `<!-- svg-source:excalidraw -->` and the rectangle path |
| `addImage()` | inserts the image; `elementCount` 1 → 2 |
| Host dirty | `page.modified` became `true` after the debounced write |
| Serialization | `type: "excalidraw"`, `version: 2`, elements `["rectangle","image"]`, one `files` entry, `image/png`, valid data URL |
| Save to disk | the file on disk carries both elements and the embedded image |
| Round-trip → built-in | switching the page to `draw-view` opens the board-written file with `elementCount: 2` |
| Editor switch options | `["monaco", "draw-view", "board-editor:…"]` — the built-in stays offered (D6) |
| External change | assigning `page.content` with the image removed drove the board scene to `elementCount: 1` with no echo back to the host |

Gates: `npm run typecheck`, `npm run lint` pass. `npm run build-prod` passed in the implementation run.

### Notes found during verification

- **The bundled board registry does not re-scan `board-manifest.json` at runtime.** After the manifest gained `fileMasks`, the first open still resolved to `draw-view`; it took a `bundledBoardRegistry.refresh()` + `customEditorRegistry.refresh()` before the board claimed the file. This is only a development concern — a shipped build reads the manifest once at startup and it never changes — but it is why a manifest edit appears not to work until Persephone restarts.
- **`serializeAsJSON` writes `source: "board://<host>"`** into saved files, where the built-in writes its own origin. The field is metadata: `DrawEditor.parseContent()` ignores it entirely, and Excalidraw's loader only validates `type`. No action needed, recorded so it is not mistaken for corruption.
- **`draw-view` dirties a hand-written `.excalidraw` file just by opening it**, through its own re-serialization. Pre-existing built-in behavior, unrelated to this task.

## Defect found by the user, and fixed — hollow dependency entries

The board rendered, but clicking any drawing tool blanked it. `assets/boards/excalidraw/ui.log`
carried `Uncaught Error: Minified React error #130` — "element type is invalid: got `undefined`".

**Root cause, in US-1486's generator, not in this task.** `scanVendorSpecifiers()` derived each
dependency's bindings from the vendor graph's import statements, but matched only
`import {…} from "spec"` and `import D, {…} from "spec"`. Three other import forms bind no names:

| form | specifiers | what was emitted |
|---|---|---|
| `import * as X from "spec"` | `@radix-ui/react-popover`, `@radix-ui/react-tabs` | **0-byte files** |
| `import("spec")` read as a namespace | `@excalidraw/mermaid-to-excalidraw` | bundled, but no exports |
| `import("spec").then(i => i.default)` | `pica`, `image-blob-reduce` | bundled, but no default |

Each fell through to the `import "spec";` side-effect fallback, so the module imported cleanly and
then read `undefined` for every member. `Popover.Root` was `undefined`, and the shape-properties
island that opens on tool selection is the first thing to render a popover — which is why the smoke
board never surfaced it and every build gate stayed green.

**The fix, in `scripts/build-board-lib.mjs`:**

- Namespace imports are detected and re-exported with `export *`. That is safe only because every
  namespace-read package resolves to a real ESM build; it still cannot re-export CommonJS bindings,
  which is why the explicit named path remains for everything else.
- Dynamic imports are classified by how the call site consumes the result — whole namespace, just
  `.default`, or discarded. The third case is real: `canvas-roundrect-polyfill` is awaited purely
  for its side effect and correctly has no exports.
- **A post-build guard**, which is the durable part: every entry must be non-empty, and must carry
  an export unless it was classified side-effect-only. This is the check US-1486 lacked. It caught
  the mermaid and `pica` cases immediately after the Radix fix — two defects that were already
  shipped and would otherwise have waited for a user to open a Mermaid diagram or export an image.

Sizes after regeneration: `radix-ui-react-popover.js` 0 → 58,276 bytes, `radix-ui-react-tabs.js`
0 → 13,545, `excalidraw-mermaid-to-excalidraw.js` → 80,994, `pica.js` → 32,909,
`image-blob-reduce.js` → 46,156. Six dependency files changed; every other file in `lib/` is
byte-identical, which confirms the vendor copy is deterministic. Total 7.5 MB.

## Second defect — the board ignored Persephone's theme

Excalidraw carries its own light/dark palette and defaults to light, so the board stayed bright
inside a dark Persephone. The bootstrap now passes `theme: persephone.theme.isDark ? "dark" : "light"`
and re-renders through `persephone.onThemeChange`, which also performs the first render because it
invokes its callback immediately. `excalidrawAPI` was made stable and idempotent at the same time —
it seeds the opening scene, and a theme re-render must not push that scene back over what the user
has since drawn.

Verified live: `.excalidraw` container class is `theme--dark`, clicking `toolbar-rectangle` keeps
`rootChildren: 1` with the shape island rendered, and `ui.log` has no further React errors.

### Font CSP noise is expected and is the offline guarantee working

`ui.log` fills with `CSP violation: font-src blocked https://esm.sh/...` for Nunito, Virgil and
Xiaolai. Excalidraw appends `ASSETS_FALLBACK_URL` to every font `src` list, and the board CSP has no
`bypassCSP`, so those entries are refused. The local fonts resolve: a direct fetch of
`./lib/fonts/Virgil/Virgil-Regular.woff2` returns **200**, and `document.fonts` reports all 8 kept
families. The violations are loud but correct — they are the proof that a missing local font would
never be silently fetched from a CDN. Only Xiaolai is genuinely absent, by the D9 exclusion.

## Third defect — "Edit" on the image viewer opened a white board

**Reported by the user, 2026-09-20.** Clicking **Edit** on an image page opened the Excalidraw
board with a blank page, and `assets/boards/excalidraw/ui.log` held exactly one error:

```
[error] script error: Uncaught Error: persephone.host is available only for content-host boards
```

Two independent defects, both shipped by this task.

### 1. The manifest declared capabilities this epic has not routed yet

`board-manifest.json` declared `image.edit` and `diagram.edit` at `priority: 60`. Capability
resolution honours that immediately — `compareCandidates` (`api/capabilities.ts:198-204`) sorts by
priority descending, so the board's registration shadowed the platform handler. Verified live before
the fix:

```
image.edit → [ board (60, board-editor:…/excalidraw), platform (50, draw-view) ]
```

The board never handles the intent: nothing in `index.html` calls `persephone.intent.onRequest`
(`board-shim.ts:1223-1232`). So every `image.edit` invocation — the image viewer's Edit button
(`ImageEditor.ts:315`), SVG (`SvgEditor.ts:69`), Mermaid (`MermaidEditor.ts:205`) — was routed into
a board with no handler instead of to the working built-in.

**Routing these intents into the board is US-1488's scope**, including the structured-clone
measurement against EPIC-108 D7. Declaring the capabilities ahead of the handler is what broke it,
so the `capabilities` block is removed from the manifest and US-1488 restores it *together with* the
handler. `permissions: ["capabilities"]` stays — the board still invokes capabilities outbound.

After the fix, `image.edit` resolves to `draw-view` again and `*.excalidraw` still resolves to the
board (`editorPriority: 60` is a separate mechanism and was never involved).

### 2. The board assumed a content host was always attached

The bootstrap read `await persephone.host.getContent()` at module top level. That rejects on any
board page opened **without** a file host, and an unhandled rejection in a `type="module"` script
kills the module before React mounts — hence a white page rather than a degraded one.

A hostless board page is not an edge case: a capability intent opens one, because the transport
opens the board with `boards.openBoard()`. (US-1489's review corrected an earlier claim here that
US-1485's creatable row also opens one - it does not. That row goes through
`PagesLifecycleModel.addBundledBoardPage()` (`:250-276`), which builds the content-host editor and
adopts a fresh unsaved `TextFileModel` host, so it always has a host.) The fix makes the host optional — the initial read is guarded, and both write
paths (`setContent` in the debounced save, and the `onContentChange` subscription) are skipped when
no host attached. The board then opens on an empty scene and works as a scratch canvas.

Verified live: `boards.openBoard()` on the bundled root now logs only `board loaded` plus the known
font-CSP noise, and `pages[i].editor.app` reports `editorIsMounted: true`, `elementCount: 0`.

### Why neither was caught

Same pattern as the first two defects: nothing here is a type error or a lint violation, and the
board's own file is not compiled at all. US-1487's verification opened the board **through a
`.excalidraw` file**, which is precisely the one path that always has a host.
