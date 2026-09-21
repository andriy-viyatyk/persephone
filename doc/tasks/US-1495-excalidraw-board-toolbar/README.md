# US-1495 — Migrate the Draw toolbar's five controls onto the Excalidraw board

**Status:** Complete  ·  **Epic:** [EPIC-112](../../epics/EPIC-112.md)  ·  **Depends on:** US-1493 (landed); US-1494 is available but not required by this task

## Goal

Declare the five controls supplied by the built-in Draw editor on the bundled Excalidraw board's
host-rendered toolbar and implement their actions through the current board shim. This closes the
EPIC-109 D11 toolbar-parity gap and is the final implementation task in EPIC-112; the built-in
Draw editor remains unchanged for EPIC-110 to remove later.

## Background

EPIC-112 Q2 is the starting trace for this task, but its routes were checked against the current
worktree. The host API is already present: `src/board-shim.ts` exposes
`persephone.toolbar.set()`, `update()`, `onAction()`, and `setText()` at lines 1299–1326; the
bridge version is already `1.11.0` in `src/shared/board-bridge-version.ts`. The board toolbar
host receives only the main permitted frame's declarations in
`src/renderer/editors/board/BoardWebview.ts:477-494` and sends action events back through
`sendToolbarControl()` at lines 557–577, so this task should be board-side only.

The catalog accepts exactly `button`, `toggle`, `menu`, `select`, and `input`, with the descriptor
fields defined in `src/ipc/board-bridge-channels.ts:266-317`. `ToolbarAction` in
`src/renderer/editors/board/BoardToolbarControls.ts:23-31` sends `{ id, type, value? }`; buttons
omit `value`, toggles send booleans, and menus send the selected item id. The host cap is
`BOARD_TOOLBAR_CONTROL_LIMIT = 8` at `BoardToolbarControls.ts:23`; entries after eight are
ignored and warned to the board log by `normalizeToolbarControlSet()` at lines 157–178.

### Verified built-in behavior

The behavior to match is `DrawToolbarView` in `src/renderer/editors/draw/index.ts`. It creates the
five controls in this order at lines 56–80 and uses these current ids/titles/icons:

| Control | Current Draw source | Current behavior verified |
|---|---|---|
| Theme | `draw/index.ts:123-130` | A local `darkMode` toggle; icon is `moon` in dark mode and `sun` in light mode. `DrawEditor.toggleDarkMode()` only flips the Draw editor state at `src/renderer/editors/draw/DrawEditor.ts:193-197`. |
| Copy image | `draw/index.ts:133-140,192-198` | Exports the current scene as a PNG blob and copies it to the clipboard. |
| Save SVG / PNG | `draw/index.ts:143-150,231-267` | One menu control with “Save as SVG” and “Save as PNG”; it uses native save dialogs and writes text or binary bytes. |
| Open SVG / image | `draw/index.ts:153-160,269-300` | One menu control titled “Open in new tab”. “Open as SVG” invokes the `content.view` capability with SVG content; “Open as Image” opens a PNG blob URL in the image viewer. It does **not** open a user-selected file and does **not** insert an SVG/image into the current scene. |
| Screen snip | `draw/index.ts:163-170,200-229` | Calls the native snip operation, then adds the returned PNG as an image to the current scene. |

This means EPIC-112 Q2's row claiming “Open SVG / image → open dialog + read + insert” is stale
for the current Draw source. The current board migration must not use `openFileDialog()`,
`readFile()`, or `insertImage()` for that menu merely because those names appeared in Q2.

### Verified board-side primitives

The board already imports `exportToBlob` and `exportToSvg` from its bundled Excalidraw library at
`assets/boards/excalidraw/index.html:65-72`. Its existing `model.exportAsSvg()` and
`model.exportAsPng()` implementations at lines 475–502 show the exact scene/export options to
reuse. Its `insertImage()` helper at lines 407–434 already adds a data URL to the live scene and
caps dimensions; the existing image intent calls it at lines 538–560.

The current shim exposes the following real methods:

- `persephone.saveFileDialog()` and `persephone.openFileDialog()` at
  `src/board-shim.ts:1457-1463`;
- `persephone.readFile()` and `persephone.writeFile()` at lines 1469–1488, including binary
  `Uint8Array` reads/writes with `{ encoding: "binary" }`;
- `persephone.openRawLink(href, { editor? })` and `persephone.openContent()` at lines 1359–1380;
- `persephone.capabilities.invoke(id, payload, options?)` at lines 1403–1417; and
- `persephone.call(path, { args? })` at lines 663–676. The current AiVision shell namespace
  declares `shell.startScreenSnip(hideWindows: boolean)` at
  `src/renderer/scripting/ai-vision/namespaces/shell.ts:3-6`.

The iframe explicitly allows clipboard read/write in
`src/renderer/editors/board/BoardWebview.ts:234-237`. The current board manifest already grants
the `capabilities` permission, so the board can invoke the platform `content.view` capability
without a manifest change.

### Verified capability and raw-link size behavior

The `content.view` route does not currently take the capability-bus payload-limit path. The board
shim forwards `persephone.capabilities.invoke()` as a capability RPC
(`src/board-shim.ts:1403-1417`); in the renderer, `Capabilities.invoke()` resolves the registration
and directly calls a platform handler when `registration.origin === "platform"`
(`src/renderer/api/capabilities.ts:323-341`). Only the subsequent non-platform branch calls
`capabilityBus.invoke()` (`src/renderer/api/capabilities.ts:344-349`). The eight-mebibyte limit is
enforced inside that bus at `src/renderer/api/capability-bus.ts:260-276`, where it rejects with
`payload-too-large` and names `MAX_INTENT_PAYLOAD_BYTES` (defined as `8 * 1024 * 1024` at
`src/ipc/capability-bus-channels.ts:1`). Therefore an SVG sent to the current platform
`content.view` handler (the SVG registration is `src/renderer/editors/register-editors.ts:170`)
does not receive this particular bus rejection; the board handler must still catch and notify every
invoke failure, and must preserve an explicit `payload-too-large` message if the registration ever
becomes board-bound. It must not silently drop a large export.

`persephone.openRawLink()` is a different, fire-and-forget path: the shim only posts the method and
arguments (`src/board-shim.ts:771-773, 1359-1361`), and the main bridge forwards the string without
a size check (`src/main/board-bridge.ts:315-323`). The event payload is only typed as `{ href,
editor? }` (`src/ipc/api-types.ts:393-396`), and the host renderer passes it to the normal open
pipeline (`src/renderer/api/internal/RendererEventsService.ts:47-53`). No repository-defined
numeric ceiling was found for a `data:` URL on this route, so its ceiling is transport/runtime
dependent rather than `MAX_INTENT_PAYLOAD_BYTES`. It is nevertheless heavier than the built-in's
blob URL because the complete data URL crosses the board-to-host/main event path; failures must be
reported through the board notification path.

### Verified icon choices

`src/renderer/editors/board/board-toolbar-icon.ts` resolves `{ name }` through the registered icon
set, `{ svg }` through its sanitizer, and `{ file }` relative to the board root. All five Draw
icons already exist in `src/renderer/theme/icon-registry.ts` (`copy`, `new-window`, `sun`, `moon`,
`snip`, and `download`). The board should therefore use only named icons: they reuse Persephone's
theme-aware artwork, require no new board assets, and avoid unnecessary inline-SVG or file-icon
resolution. The theme descriptor must patch its named icon from `moon` to `sun` when its local
value changes.

## Implementation Plan

### 1. Add the exact five-control declaration to the board

Change only `assets/boards/excalidraw/index.html`. Keep the existing host-rendered order from
`DrawToolbarView`: theme, copy image, save menu, open-in-new-tab menu, and screen snip. The initial
`persephone.toolbar.set()` payload must be equivalent to this array (the theme title/icon/value
are derived from the board's `drawDarkMode` variable):

```js
[
    {
        id: "draw-theme",
        type: "toggle",
        label: "Theme",
        title: drawDarkMode ? "Switch to Light Theme" : "Switch to Dark Theme",
        icon: { name: drawDarkMode ? "sun" : "moon" },
        value: drawDarkMode,
    },
    {
        id: "draw-copy-image",
        type: "button",
        label: "Copy image",
        title: "Copy Image to Clipboard",
        icon: { name: "copy" },
    },
    {
        id: "draw-save",
        type: "menu",
        label: "Save as file",
        title: "Save as file",
        icon: { name: "download" },
        items: [
            { id: "save-svg", label: "Save as SVG" },
            { id: "save-png", label: "Save as PNG" },
        ],
    },
    {
        id: "draw-open-new-tab",
        type: "menu",
        label: "Open in new tab",
        title: "Open in new tab",
        icon: { name: "new-window" },
        items: [
            { id: "open-svg", label: "Open as SVG" },
            { id: "open-image", label: "Open as Image" },
        ],
    },
    {
        id: "draw-snip",
        type: "button",
        label: "Screen Snip",
        title: "Screen Snip",
        icon: { name: "snip" },
    },
]
```

All five ids satisfy the catalog's safe-id rule, both menus contain valid `{ id, label }` items,
and the array contains five of the eight permitted top-level controls. The labels intentionally
carry the same user-facing names as the built-in controls; the icons and titles retain the
built-in affordances. Do not add `select` or `input` controls as padding or use a custom SVG/file
icon.

Before → after declaration placement:

```js
// Before: assets/boards/excalidraw/index.html currently exposes the model and renders Excalidraw,
// but never declares host toolbar controls.
persephone.aiVision.expose(model);
// ...
const unsubscribeTheme = persephone.onThemeChange(renderBoard);

// After: keep the existing model exposure, then declare the five controls from the main board.
persephone.aiVision.expose(model);
persephone.toolbar.set(createDrawToolbarControls());
const unsubscribeToolbar = persephone.toolbar.onAction(handleDrawToolbarAction);
// ... retain intent/content/navigation cleanup and only non-toolbar theme work; dispose on unload.
```

### 2. Keep theme behavior board-local with a one-time app-theme seed

The built-in `DrawEditor` owns a local `darkMode` setting and seeds it from the app theme only on
first construction (`src/renderer/editors/draw/DrawEditor.ts:69-72`); its restore path then prefers
the saved Draw setting (`:85-103`). The board shim exposes the current app theme as a read-only
`persephone.theme.isDark` value and an `onThemeChange()` subscription, but no board method that sets
the app theme. Seed a board-local `drawDarkMode` once at board load from `persephone.theme.isDark`:

- never re-seed `drawDarkMode` from later app-theme pushes and do not add a local-override flag;
- the `draw-theme` toggle action sets `drawDarkMode` from the boolean event value;
- after changing it, call `renderBoard()` and
  `persephone.toolbar.update([{ id: "draw-theme", value, title, icon: { name: ... } }])`;
- pass `drawDarkMode ? "dark" : "light"` to Excalidraw's `theme` prop at the current
  `assets/boards/excalidraw/index.html:614-631` render site; use the same value for
  `exportWithDarkMode` in the SVG/PNG export helpers.

This deliberately changes the board's current behavior: it presently passes
`persephone.theme.isDark` straight to Excalidraw and re-renders from `onThemeChange`
(`assets/boards/excalidraw/index.html:614-640`), so it follows later app-theme changes. Local
ownership is required for a toolbar toggle and matches Draw; keep `onThemeChange` only for any
other theme-dependent board work, never to re-seed this value. This route does not call
`persephone.toolbar.setText()`: the board has no toolbar-specific text, so US-1494's fallback
should continue showing the board path. Do not use `setStatusText()` either; that targets the
content-host footer, not this page toolbar.

Before → after the Excalidraw theme prop:

```js
// Before: assets/boards/excalidraw/index.html:616-619
theme: persephone.theme.isDark ? "dark" : "light",

// After: the toolbar toggle and the board use one local value.
theme: drawDarkMode ? "dark" : "light",
```

### 3. Implement the five action handlers with the real board APIs

Register one `persephone.toolbar.onAction()` callback and dispatch by both `id` and `type`.
Ignore malformed/unrecognized values defensively even though the host catalog validates the event.
Use the board's existing `notify()`/error-reporting pattern for failed asynchronous actions and
do not access Electron, Node `fs`, renderer `app`, or renderer `pagesModel` from the board.

#### Theme: `draw-theme` / `toggle`

Read the event's boolean `value`, update the local theme state, rerender, and patch the descriptor
with `toolbar.update()` so the host keeps the checked state, title, and `sun`/`moon` icon aligned.
There is no missing board equivalent: the built-in setting is local to Draw, and Excalidraw already
receives a board-owned `theme` prop.

#### Copy image: `draw-copy-image` / `button`

Reuse the existing `exportToBlob()` scene options from `model.exportAsPng()` (or extract one shared
`exportCurrentPngBlob()` helper so the existing AI/API method and toolbar use the same export).
When the scene has no elements, follow the built-in's guard and notify that there is nothing to
export. Otherwise call:

```js
const blob = await exportCurrentPngBlob();
await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
]);
```

This is the verified board equivalent of `exportAsPngBlob()` plus
`copyPngBlobToClipboard()`. `BoardWebview` grants the iframe clipboard permissions, so no shim
clipboard method or `persephone.call()` route is needed.

#### Save SVG / PNG: `draw-save` / `menu`

Dispatch the selected menu value `save-svg` or `save-png`. Preserve the built-in default-name
behavior: use `await persephone.getFilePath()` when available, strip the final `.excalidraw`
extension and path components in the board, and fall back to `drawing.<ext>` for a plain board or
unavailable path. `getFilePath()` is a real shim method documented at
`src/board-shim.ts:1514-1525`; it may reject, so the default-name helper must handle that case.

- SVG: export the current scene with `exportToSvg()`, call
  `await persephone.saveFileDialog({ title: "Save as SVG", defaultPath, filters: [{ name: "SVG", extensions: ["svg"] }] })`,
  and, when a path is returned, call `await persephone.writeFile(path, svgText)`.
- PNG: export a PNG `Blob`, call the matching save dialog with a PNG filter, convert the blob's
  `arrayBuffer()` to `new Uint8Array(...)`, and call
  `await persephone.writeFile(path, bytes, { encoding: "binary" })`.

These are the real shim names verified above. `fs.showSaveDialog`, `fs.write`, and
`fs.saveBinaryFile` are renderer-only built-in Draw helpers and must not appear in board code.

#### Open SVG / image: `draw-open-new-tab` / `menu`

Dispatch `open-svg` or `open-image` using the behavior that the current Draw source actually has;
do not implement a file-open/import flow.

- SVG: export the current scene and call
  `await persephone.capabilities.invoke("content.view", { representation: "svg", content: svgText, language: "xml", title: defaultName })`.
  This is the board-facing equivalent of the built-in's current `app.capabilities.invoke("content.view", …)` call.
  The current platform-handler branch bypasses the capability bus's 8 MiB rejection, as verified
  above; still catch the rejection and notify through the board path, preserving the named limit if
  a future registration routes this invocation through the bus.

- Image: export a PNG blob, convert it with the existing `blobToDataUrl()` helper, and call
  `persephone.openRawLink(dataUrl, { editor: "image-view" })`. This is the board-facing equivalent
  of `pagesModel.openImageInNewTab(blobUrl)` and is supported by the shim's fire-and-forget
  `openRawLink()` method. The source has no numeric application ceiling for this data URL, but the
  route is heavier than the built-in blob URL and its transport/runtime limit is unspecified; catch
  and notify failures.

The current built-in has no file-selection behavior here, so `persephone.openFileDialog()` and
`persephone.readFile()` are deliberately unused. There is no unimplemented parity gap in this
control once the stale Q2 route is corrected; adding a file importer would be a new feature.

#### Screen snip: `draw-snip` / `button`

Call the real AiVision route from the shim:

```js
const dataUrl = await persephone.call("shell.startScreenSnip", { args: [true] });
if (typeof dataUrl !== "string" || !dataUrl) return;
const dimensions = await getImageDimensions(dataUrl);
insertImage(dataUrl, mimeFromDataUrl(dataUrl), dimensions);
```

Reuse the current board `insertImage()` helper and its 1200-pixel cap. Keep the existing board
content-save flow: the Excalidraw `onChange` path schedules `persephone.host.setContent()` at
`assets/boards/excalidraw/index.html:371-394`; if the handler explicitly calls
`writeCurrentSceneToHost()`, call it once after insertion to commit the same immediate scene change
without bypassing the existing echo/fingerprint guards. A null/cancelled snip is a no-op, matching
the built-in.

### 4. Wire lifecycle cleanup without changing host code

Store the unsubscribe returned by `persephone.toolbar.onAction()` and invoke it in the existing
`beforeunload` handler at `assets/boards/excalidraw/index.html:642-648`. The host already clears
the catalog, menus, dynamic element declarations, and pending input timers on reload/disposal in
`BoardWebview.ts`; the board only needs to stop its action callback and existing theme/intent
subscriptions.

Do not change the bridge, descriptor catalog, host toolbar composition, board icon resolver, or the
built-in Draw editor. US-1493/1494 already provide the contract this board consumes.

### 5. Handle the eight-control cap and menus

The five declarations fit under the current eight-control cap. Save's two choices and Open's two
choices must remain menu items within one `menu` control each, so they consume two top-level slots,
not four. The current catalog supports a flat menu item list only; if a future board needs another
submenu level, it must be represented by another supported menu/control design or recorded as a
catalog limitation—there is no nested submenu descriptor to invent here.

If this board ever declares more than eight top-level controls, the existing host normalization
keeps the first eight valid entries, ignores later entries, and writes warnings to `ui.log`; it
does not create an overflow menu. This task declares five and therefore needs no overflow behavior.

## Concerns

- **Q2 route correction:** the current Draw implementation proves that “Open SVG / image” means
  exporting the current drawing to new tabs. The task must preserve that behavior and explicitly
  avoid the Q2 file-dialog/read/insert route.
- **Theme scope:** the board shim provides `persephone.theme.isDark` and `onThemeChange()`, but no
  setter for the application theme. The toggle is therefore a local Excalidraw/Draw preference;
  it must not pretend to change Persephone's global theme. If persistence across board reloads is
  required later, that is a separate board-state decision; this migration has no existing board
  persistence contract for this setting.
- **Async action failures:** export, dialogs, capability invocation, clipboard, and screen capture
  can reject. Each handler must report failures through the board's existing notification/log
  path and avoid leaving stale menu/action state behind.
- **Empty scenes:** the built-in refuses copy/save/open exports when there are no scene elements;
  the board handlers need the same guard rather than creating empty files or tabs.
- **No `toolbar.setText()`:** US-1494 is present and verified, but this board has no replacement
  label. Leaving the text unset intentionally preserves the board-path fallback.
- **No fabricated file-open support:** `openFileDialog()` and `readFile()` are real APIs, but the
  current Draw control does not use them. They must remain out of this task unless the user changes
  the requested parity target.

## Acceptance Criteria

1. `assets/boards/excalidraw/index.html` calls `persephone.toolbar.set()` once for the main board
   with exactly five valid descriptors in Draw order: `draw-theme` (`toggle`),
   `draw-copy-image` (`button`), `draw-save` (`menu`), `draw-open-new-tab` (`menu`), and
   `draw-snip` (`button`). Every descriptor has the documented label/title/icon shape; menu item
   ids and labels are valid.
2. The named icons resolve through the current registry: `sun`/`moon`, `copy`, `download`,
   `new-window`, and `snip`. No `{ svg }` or `{ file }` icon is introduced.
3. Theme toggling changes only the board's local Excalidraw theme, updates the descriptor value,
   title, and icon through `persephone.toolbar.update()`, and does not call `toolbar.setText()`.
4. Copy exports the current scene as PNG and writes an `image/png` `ClipboardItem` through the
   browser clipboard API; the empty-scene path reports the same no-content condition as Draw.
5. Save SVG uses `persephone.saveFileDialog()` plus `persephone.writeFile()` with text; save PNG
   uses the same dialog plus `writeFile()` with a `Uint8Array` and `{ encoding: "binary" }`.
6. Open SVG invokes `persephone.capabilities.invoke("content.view", …)` with `representation:
   "svg"`; Open Image converts the PNG blob to a data URL and calls
   `persephone.openRawLink(dataUrl, { editor: "image-view" })`. Neither action opens a file or
   inserts the exported result into the current scene.
   The board reports any capability or raw-link failure through its notification path; it does not
   silently swallow an oversized export.
7. Screen Snip calls `persephone.call("shell.startScreenSnip", { args: [true] })`, treats cancel as
   a no-op, and inserts a returned PNG through the existing `insertImage()` path.
8. The board unsubscribes from toolbar actions on `beforeunload`; existing intent, content, and
   navigation cleanup remains intact, and any retained `onThemeChange` subscription is cleaned up.
9. Exactly five top-level controls are declared, so the eight-control cap is not reached and no
   overflow UI is needed. Any future over-cap behavior remains the host's documented first-eight-
   plus-`ui.log` warning behavior.
10. `src/renderer/editors/draw/index.ts`, `src/board-shim.ts`, `BoardToolbarControls.ts`,
     `board-toolbar-icon.ts`, `BoardToolbar.ts`, `BoardWebview.ts`, `BoardEditorModel.ts`, and
     `board-manifest.json` are not modified by this task.

## Files Changed Summary

| File | Change |
|---|---|
| `assets/boards/excalidraw/index.html` | Add the five host-toolbar descriptors, local theme synchronization, export/clipboard/dialog/capability/snip action handlers, default-name handling, and toolbar-action cleanup. |
| `src/renderer/editors/draw/index.ts` | **No change.** It is the behavior reference and is scheduled for removal by EPIC-110. |
| `src/board-shim.ts` | **No change.** `toolbar.set/update/onAction/setText`, dialogs, file I/O, `openRawLink`, `capabilities.invoke`, `call`, and `getFilePath` are already present. |
| `src/renderer/editors/board/BoardToolbarControls.ts` | **No change.** The five descriptors and action payloads already fit its catalog. |
| `src/renderer/editors/board/board-toolbar-icon.ts` | **No change.** Named registry icons are sufficient. |
| `src/renderer/editors/board/BoardToolbar.ts` | **No change.** The host already mounts the board-control group between the path and Persephone controls. |
| `src/renderer/editors/board/BoardWebview.ts` | **No change.** Main-frame declaration validation and action delivery already exist. |
| `src/renderer/editors/board/BoardEditorModel.ts` | **No change.** Toolbar declarations are already transient and lifecycle-scoped. |
| `assets/boards/excalidraw/board-manifest.json` | **No change.** The existing `capabilities` permission is sufficient; no new bridge minimum is required. |
| `doc/active-work.md` | User-maintained dashboard entry; outside this implementation's edits. |
| `doc/epics/EPIC-112.md` | User-maintained epic/Q2 correction; outside this implementation's edits. |
