# US-1493 — Board toolbar control descriptors and the control catalog

**Status:** Complete  ·  **Epic:** [EPIC-112](../../epics/EPIC-112.md)  ·  **Depends on:** none; rebase with US-1492 if both touch `BoardToolbar.ts`; US-1494 and US-1495 consume this contract

## Goal

Give a trusted or bundled board a fixed, host-rendered toolbar catalog. A board calls
`persephone.toolbar.set(controls[])` to declare the complete ordered control list and
`persephone.toolbar.update(partial[])` to patch existing controls by `id`. Persephone renders the
controls in `BoardToolbarView`, keeps live values in the host, and sends a control-operation event
back through the board bridge.

This is an investigation and planning document. It must be reviewed before production code is
changed. The binding decisions in [EPIC-112](../../epics/EPIC-112.md) are settled: the catalog is
exactly `button`, `toggle`, `menu`, `select`, and `input`; values are host-owned and uncontrolled;
`set` defines existence/order while `update` cannot add, remove, or reorder; `set` must preserve
focus, caret, and scroll for controls that survive; the catalog is capped at eight rendered
controls; board controls are visually separated from Persephone controls; and no new trust
permission is introduced.

## Background

### Verified bridge precedent

`src/board-shim.ts:1241` implements `setSecondaryViews()` as the board-to-host precedent. It
validates only the array shape needed by the public method, posts a plain object to
`window.parent` with the `__persephone` discriminator, uses the boot-time `hostPostTarget`, and
swallows the parent-gone exception. The toolbar methods must use the same posting path and error
behavior.

US-1489 supplies the host-to-board precedent. `navigation:return` is declared in
`src/ipc/board-bridge-channels.ts`, `BoardWebview.handleMessage()` validates the live frame and
origin before posting to that exact iframe, and `src/board-shim.ts` handles the message through its
existing `onHostMessage()` path before exposing a public event object without the internal
`__persephone` field. Toolbar events must follow that same direction, frame, origin, and lifecycle
model; they must not become a main-process RPC or a second board transport.

The current bridge version in `src/shared/board-bridge-version.ts` is `1.9.0`; this contract is an
additive `1.10.0` bridge change. The existing board bridge build path already includes
`src/board-shim.ts`; `src/main/board-bridge.ts` does not need a new channel implementation.

### Public descriptor and event contract

The task must implement this exact public namespace and payload vocabulary in the runtime shim and
the two maintained board-authoring guides. D7 permits three icon sources: a registry name, inline
SVG, or a board-root-relative file path.

```ts
type BoardToolbarIcon =
    | { name: string }
    | { svg: string; preserveColors?: boolean }
    | { file: string; preserveColors?: boolean };

type BoardToolbarControlDescriptor =
    | {
        id: string;
        type: "button";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "toggle";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        value: boolean;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "menu";
        label?: string;
        title?: string;
        icon?: BoardToolbarIcon;
        items: Array<{ id: string; label: string; disabled?: boolean }>;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "select";
        label?: string;
        title?: string;
        options: Array<{ value: string; label: string }>;
        value: string;
        disabled?: boolean;
    }
    | {
        id: string;
        type: "input";
        label?: string;
        title?: string;
        value: string;
        placeholder?: string;
        disabled?: boolean;
    };

persephone.toolbar.set(controls: BoardToolbarControlDescriptor[]): void;
persephone.toolbar.update(partial: Array<Partial<BoardToolbarControlDescriptor> & { id: string }>): void;
persephone.toolbar.onAction(handler: (event: {
    id: string;
    type: BoardToolbarControlDescriptor["type"];
    value?: boolean | string;
}) => void): () => void;
```

The event semantics are fixed: a button emits `{ id, type: "button" }`; a toggle emits its new
boolean `value`; a menu emits the selected item `id` as its string `value`; a select emits its
selected option `value`; and an input emits its current string `value` after a 500 ms debounce.
The board is not required to echo a value change. An explicit `update` value is the host-authority
way to set it later.

`set` accepts the full desired array, preserves the supplied order, and defines additions and
removals. IDs must be non-empty, unique strings; invalid entries and entries after the eight-item
cap are ignored with a warning sent to the current board `ui.log`. Duplicate IDs keep the first
valid occurrence. `update` is an id-keyed patch: omitted fields stay unchanged, an unknown ID is
ignored with a warning, and `id` and `type` are immutable for an existing view. A patch that tries
to change `type`, add an ID, remove an ID, or reorder controls is ignored for that structural part
and logged. An update never changes the order established by the last `set`.

### Renderer and existing controls

`src/renderer/editors/board/BoardToolbar.ts` currently owns a custom `board-toolbar` panel. Its
mounted Persephone controls are, in order, the Explorer button, board path, reload button, log
button, properties panel, and `SwitchWidgetView`. The board webview is mounted below this toolbar
by `BoardEditorView.BoardHostView`; the iframe is not the toolbar and must not be used as the
control DOM.

Keep `BoardToolbarView`'s existing direct composition and append the board-control group between
the path slot and Persephone's own reload, log, and properties controls. Keep the existing
`board-toolbar-explorer`, `board-toolbar-reload`, `board-toolbar-log`, `board-toolbar-properties`,
and `board-trust` addresses unchanged; they are published through `BOARD_ELEMENTS` and the agent
guide. `SwitchWidgetView` remains the existing final Persephone control. `PageToolbarView.ts` is a
widget source here, not a shell to adopt.

Add a visible boundary around the board-control group: use a named group with the existing panel
layout/theme tokens, leading spacing, and a theme-aware separator/border before the first board
control. Do not use hard-coded colors. This is EPIC-112 D5’s visual grouping, not a trust or
security boundary. The path/control group must remain usable when the existing path text’s flex,
width-zero, and overflow-hidden behavior is squeezing the toolbar.

Use the existing components rather than creating parallel primitives:

- `SwitchWidgetView` from `src/renderer/editors/base/PageToolbarView.ts` remains the
  Persephone editor switch; `SwitchView` from `src/renderer/uikit/Switch/SwitchView.ts` renders a
  board `toggle`.
- `IconButtonView` renders `button` and menu triggers and supplies `data-name`, tooltip, disabled,
  and focus behavior. The catalog's icon adapter supplies either a registry icon, a sanitized
  inline SVG element, or a confined image element to the existing icon slot.
- `SelectView` renders `select`; it already composes `InputView`, `ListBoxView`, and
  `PopoverView`.
- `InputView` renders `input`; its `onChange` receives the string value directly. The catalog
  layer owns the 500 ms debounce and cancels it when a control is removed or the frame is disposed.
- `openMenu()` and `MenuHandle` from `src/renderer/uikit/Menu/attach-menu.ts` render `menu`
  controls. Follow `DrawToolbar` in `src/renderer/editors/draw/index.ts`: open a menu from the
  trigger, retain the `MenuHandle`, update its item list in place, dispose it on removal, and
  restore focus to the trigger when it closes.
- `PopoverView` remains the existing floating primitive. Use it through `SelectView` and only use
  it directly where the catalog genuinely needs a popover; do not create a second dropdown/menu
  implementation.
- A board identity marker or fallback icon uses `createBoardGlyphElement()` from
  `src/renderer/editors/board/board-glyph-element.ts`, which resolves through the existing
  `board-icon-cache.ts` (`icon.svg`, `icon.png`, then `icon.ico`). This identity cache holds one
  icon per board root and is not suitable for descriptor icons. Descriptor icons need a separate
  cache keyed by board root plus path.
- D7 descriptor icons accept `{ name }`, `{ svg }`, or `{ file }`. SVG is parsed with `DOMParser`
  and rebuilt node by node against an allowlist, then inlined with `fill`/`stroke` forced to
  `currentColor`; `{ preserveColors: true }` renders an SVG through `<img>` instead. Raster files
  render through `<img src={path}>`. `{ file }` is resolved only relative to the board root and
  rejects absolute paths, `..`, and paths outside that root. The sanitizer rejects scripts,
  styles, `foreignObject`, `image`, `use`, event-handler attributes, and non-fragment links,
  requires a `viewBox`, and caps markup size. This prevents accidental restyling/beacons and keeps
  theming predictable; it is not a security boundary because trusted boards already have
  `executeNode`.

### UI element contract

`doc/architecture/ui-element-contract.md` makes `data-name` the agent-facing addressing handle;
classes, `data-type`, `data-part`, and `data-component` are not substitutes. UIKit `name` props
emit `data-name`, so each live board control needs the stable name
`board-toolbar-control-${id}` on its trigger or input root. The menu’s trigger owns the name; the
transient menu items are addressed only after the menu is open. Select and input roots retain their
component `data-type` and accessibility attributes.

The current `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` has a static
`BOARD_ELEMENTS` array for `board-toolbar-explorer`, `board-toolbar-reload`,
`board-toolbar-log`, `board-toolbar-properties`, and `board-trust`. Its `aiVision()` method passes
that array to `createElements()` and returns the same declarations in `elements`; the existing
help correctly describes these as board-page chrome, not iframe content.

Replace that static-only list with a live declaration builder that merges the current static host
elements and the current, mounted board-control descriptors. Use the same merged list for
`createElements()` and the returned `elements`, `members`, and `provide` behavior. Purpose text
must include the descriptor label/type and `where` must identify the board toolbar. Validate IDs
before interpolating them into `data-name`/selector declarations; an invalid ID must never create
a selector containing quotes or backslashes.

This makes controls listable and highlightable by the element API. It also makes the host selector
available to the generic screen/window automation surface. Do not claim that
`BoardEditorFacade.click()`, `type()`, or `select()` operate toolbar controls: those methods
currently target `this.editor.target`, the board iframe. If a convenience operation is added, it
must route through the host element/window surface rather than pretending the iframe contains the
control.

### Lifecycle and authority

`BoardEditorModel` currently persists durable board state and keeps `busy`/`statusText` transient.
`BoardWebview.onDispose()` marks the frame dead, increments its generation, rejects pending work,
releases navigation-return ownership, clears the model iframe, and removes the iframe. `handleLoad`
resets the frame generation and re-registers its transports. `BoardEditorView` remounts the host
branch on `reloadToken` changes.

The toolbar catalog is transient frame state. Keep only the main board frame’s live declarations;
do not persist them in `getRestoreData()`, expose them from a secondary view, or resurrect them from
the model after a reload. On frame load, clear the old registry before accepting the new frame’s
`set`. On frame disposal, clear the registry, cancel input debounce timers, dispose menus/popovers,
remove dynamic element declarations, and reject/ignore late events using the existing live-frame,
source-window, origin, and generation checks.

When a busy board navigates away, `EditorModel.keepAliveOnNavigation()`/`survivesNavigation()` keep
the model and its work alive, but the toolbar view is no longer mounted as the active page chrome.
Therefore its controls must not remain agent-visible or receive events while the board is away. On
reuse, the newly mounted live frame declares the controls again; the old catalog is not restored.
Untrusted boards already render `UntrustedBoardView` instead of `BoardHostView` in
`BoardEditorView`; the new API adds no permission and must not bypass that branch.

## Implementation Plan

### 1. Add the typed bridge messages and runtime shim API

Change `src/ipc/board-bridge-channels.ts` by extending the existing broad `BoardToHostMsg` union
with board-to-host declarations and adding one host-to-board event interface to
`BoardHostFrameMsg`:

```ts
// Current BoardToHostMsg shape: a union discriminated by __persephone, including
// { __persephone: "board:setSecondaryViews"; views: ... }.

// Planned additions:
type BoardToolbarSetMsg = {
    __persephone: "board:setToolbarControls";
    controls: readonly BoardToolbarControlDescriptor[];
};

type BoardToolbarUpdateMsg = {
    __persephone: "board:updateToolbarControls";
    controls: readonly BoardToolbarControlPatch[];
};

export interface BoardToolbarControlEventMsg {
    __persephone: "toolbar:control";
    id: string;
    type: "button" | "toggle" | "menu" | "select" | "input";
    value?: boolean | string;
}
```

Use the repository’s existing dependency-free IPC type style. The board-to-host payload may use
readonly wire arrays, but the renderer must normalize into owned records before rendering. Include
`BoardToolbarControlEventMsg` in `BoardHostFrameMsg` exactly as US-1489 includes
`BoardNavigationReturnMsg`; do not add a main-process channel.

In `src/board-shim.ts`, add `set`, `update`, and `onAction` beside the existing public bridge
facades. The before/after posting shape is:

```ts
// Before: the existing precedent at setSecondaryViews().
setSecondaryViews(views) {
    try {
        window.parent.postMessage(
            { __persephone: "board:setSecondaryViews", views: Array.isArray(views) ? views : [] },
            hostPostTarget,
        );
    } catch { /* parent gone */ }
}

// After: same parent/origin target and same safe-post behavior.
toolbar: {
    set(controls) {
        postToolbarMessage({
            __persephone: "board:setToolbarControls",
            controls: Array.isArray(controls) ? controls : [],
        });
    },
    update(partial) {
        postToolbarMessage({
            __persephone: "board:updateToolbarControls",
            controls: Array.isArray(partial) ? partial : [],
        });
    },
    onAction: onToolbarAction,
},
```

`postToolbarMessage()` must be the same small `try/catch` wrapper, with no new transport. Register
the callback through `onHostMessage()`, validate the discriminator and required scalar fields, and
pass a new `{ id, type, value }` object to callbacks. Strip `__persephone`, as the current
`navigation:return` handler does. Return an idempotent unsubscribe function like
`onNavigationReturn()`.

Set `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `"1.9.0"` to `"1.10.0"`.
The guides and board template must state the same minimum version. No change is required in
`src/main/board-bridge.ts`: the existing inline/build bridge path already carries the typed
renderer/shim contract.

### 2. Receive declarations and deliver events only to the live main frame

In `src/renderer/editors/board/BoardWebview.ts`, extend the existing validated `handleMessage()`
switch for `board:setToolbarControls` and `board:updateToolbarControls`. Accept messages only from
the current iframe window and the existing `board://${host}` origin checks. Restrict toolbar
declarations to the main board frame (`isMain`/the existing main-tab identity); a secondary frame
must not replace the page toolbar catalog.

Normalize descriptors before the view sees them: validate the fixed type, non-empty safe ID,
type-specific fields, duplicate IDs, and the eight-control cap. Log ignored input through the
existing `appendLog("warn", ...)` path so warnings reach the board’s `ui.log`; if the frame is
already disposed, ignore it safely because there is no live board log target.

Expose a narrow send method from `BoardWebview` or its host callback that posts this exact event to
the current main frame:

```ts
// Current US-1489 host-to-board pattern: BoardWebview posts a typed message to
// frame.contentWindow with the exact board://host target origin after live-frame checks.

// Planned toolbar event:
frame.contentWindow.postMessage(
    { __persephone: "toolbar:control", id, type, value },
    `board://${host}`,
);
```

Guard the send with the same permitted-board, `live`, iframe identity, source/generation, and
target-origin checks used by `navigation:returnUrl`. `BoardToolbarView` should receive an event
callback from `BoardHostView`, not discover or retain a stale iframe itself. Omit `value` for a
button action; include the normalized value for toggle, menu, select, and input.

### 3. Add the catalog renderer and D3a reconciliation

Create `src/renderer/editors/board/BoardToolbarControls.ts` for the descriptor types, validation,
catalog records, component construction, event normalization, and keyed reconciliation. Keep
`BoardToolbar.ts` responsible for toolbar composition and the callback into `BoardWebview`.

The renderer map is keyed by descriptor ID. Each record owns its view, root, current normalized
descriptor, and any menu/debounce cleanup. Build each type from the existing components named in
Background. Keep descriptor icon resolution in a separate
`src/renderer/editors/board/board-toolbar-icon.ts` module. It must cache resolved file contents by
board root plus path; do not reuse `board-icon-cache.ts`, whose current key is only the board root
and whose purpose is the single board identity icon. Resolve `{ name }` through the registered
icon set. For `{ svg }` and SVG `{ file }`, parse with `DOMParser` and rebuild the tree node by node
against an explicit allowlist—never `innerHTML` or regex sanitization—requiring `viewBox`, rejecting
`script`, `style`, `foreignObject`, `image`, `use`, every `on*` attribute, and any external
`href`/`xlink:href`, and enforcing the markup-size cap. Force `fill` and `stroke` to
`currentColor` unless `preserveColors: true`, in which case render the SVG through `<img>`. Raster
files render through `<img>` after board-root confinement rejects absolute paths, `..`, and escapes.
A board icon marker, if used, is still created with `createBoardGlyphElement()` and the existing
identity-icon cache.

Implement `set` as an actual keyed diff, not a teardown/rebuild:

1. Normalize the incoming full array, dedupe by ID, apply the eight-item cap, and create a next ID
   sequence. Capture the currently focused catalog ID and focus sub-element. For an input, capture
   `selectionStart`, `selectionEnd`, and `selectionDirection`. Capture `scrollTop`/`scrollLeft`
   for the control root and every scrollable descendant in surviving records.
2. For every next ID, reuse the existing record and call its in-place update when the ID survives;
   create a record only for a new ID. Do not replace a surviving root. Reuse the same `MenuHandle`
   while updating menu items.
3. Dispose records whose IDs are absent, including menu handles and pending input debounce timers.
   Append the surviving/new roots in next-array order. Appending an existing node moves it without
   destroying focus or input selection; do not use `replaceChildren()` or wholesale innerHTML for
   the catalog.
4. After DOM order is settled, restore focus to the surviving target with
   `focus({ preventScroll: true })`, restore/clamp the saved input selection to the current value,
   and restore each captured scroll position after layout. If the focused ID was removed, do not
   steal focus; let normal browser focus behavior apply.
5. Publish the resulting live declarations to the model/facade only after the keyed map and DOM
   are consistent. A surviving control keeps its identity even when its position changes in a
   subsequent `set`; `set` order is authoritative, not identity.

`update(partial[])` uses the same record map but never runs structural order/add/remove logic. For
each known ID, merge omitted properties into the normalized descriptor, reject type changes, and
call the record’s in-place update. A value update must preserve the input’s caret when the new value
does not make it invalid; otherwise clamp it. An input user event updates the live host value
immediately and queues exactly one board event after 500 ms of quiet time.

### 4. Mount the group in BoardToolbarView with D5 separation

Keep `src/renderer/editors/board/BoardToolbar.ts`'s current direct root composition. Add one
named board-control group after the path panel and before the Persephone-owned reload, log, and
properties controls. The current shape is:

```ts
// Current source: BoardToolbarView owns a custom root and appends all controls directly.
this.root.append(
    this.explorerButton.root,
    this.pathPanel,
    this.reloadButton.root,
    this.logButton.root,
    this.propertiesPanel,
    this.switchWidget.root,
);
```

The target shape is:

```ts
// Planned shape: preserve every existing Persephone control and insert only the board group.
this.root.append(
    this.explorerButton.root,
    this.pathPanel,
    this.boardControls.root,
    this.reloadButton.root,
    this.logButton.root,
    this.propertiesPanel,
    this.switchWidget.root,
);
```

`boardControls` has a stable root such as `board-toolbar-controls`, a theme-token separator, and
an explicit leading gap. Add only the small board-toolbar CSS needed for this boundary; do not alter
generic UIKit colors or create a new toolbar primitive. The group is visual D5 ownership signaling,
not a trust boundary. The existing path panel remains `flex`, width-zero, and overflow-hidden, so
it absorbs squeeze before the board controls are harmed.

Apply board state updates to the path/properties views and to the control host without rebuilding
the toolbar root. US-1492 and US-1493 are independent; whichever lands second rebases on the
other’s `BoardToolbar.ts` changes. US-1493 must not restore the path switcher popover or alter the
published Persephone control names while inserting the board group.

### 5. Make BoardEditor.elements live

Update `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` so the static declarations remain
for Persephone-owned board chrome and dynamic declarations are appended only while the main toolbar
catalog is mounted. The current/target difference is:

```ts
// Current: one static list is passed to createElements() and returned unchanged.
const elements = createElements(BOARD_ELEMENTS, ui.highlightElement.bind(ui), options);
return { members: [...elements.members], elements: BOARD_ELEMENTS, provide: elements.provide };

// Target: the same live merged declarations drive listing, highlighting, and provisioning.
const declarations = [
    ...BOARD_ELEMENTS,
    ...model.getLiveToolbarElementDeclarations(),
];
const elements = createElements(declarations, ui.highlightElement.bind(ui), options);
return { members: [...elements.members], elements: declarations, provide: elements.provide };
```

Use the actual facade’s page scope, `beforeHighlight`, and `highlightOptions: { all: true }` logic.
The dynamic getter must return an empty list for an untrusted, disposed, inactive, or not-yet-
mounted toolbar. A control declaration’s selector must address its `data-name`, and its purpose
and location must be useful in an agent snapshot. Highlighting must activate the page/layout using
the existing facade path; no iframe snapshot query should be added.

### 6. Clear transient state across reload, navigation, and disposal

Add the smallest transient catalog ownership seam to `BoardEditorModel`/`BoardWebview` needed by
the facade and toolbar. Do not include the catalog in durable restore data. The current lifecycle
has model iframe cleanup in `BoardWebview.onDispose()` and load-generation reset in `handleLoad()`;
extend those paths as follows:

```ts
// Current lifecycle: frame disposal clears the iframe and releases frame-scoped services.
protected onDispose(): void {
    this.live = false;
    this.generation++;
    // reject pending work, release navigation frame, model.clearIframe(), remove iframe
}

// Target lifecycle: the same path also retires toolbar declarations before late messages can act.
protected onDispose(): void {
    this.live = false;
    this.generation++;
    this.model.clearToolbarControlsForFrame(this.frameGeneration);
    this.toolbarControls?.dispose();
    // existing pending-work/navigation/iframe cleanup follows
}
```

At the start of `handleLoad()`, retire the previous generation before accepting a new `set`. On a
reload, the `reloadToken` remounts the branch and therefore creates a fresh catalog. On navigate-away
from a busy board, retain the model/job survival required by US-799 but clear the host-visible
toolbar declarations when the toolbar/frame is no longer active. On reuse, the new live frame calls
`set` again. On page close or model disposal, clear the catalog and all dynamic element declarations
and ignore stale callbacks.

### 7. Update maintained authoring references

Update `assets/guides/agents/boards.md` and `assets/board-template/CLAUDE.md` with the public API,
descriptor schema, event values, 500 ms input debounce, eight-control cap and warning behavior,
D7 icon sources and rendering/sanitization rules, trust/lifecycle rules, agent-visible `data-name`
behavior, and bridge version `1.10.0`. Keep the legacy
`src/renderer/editors/board/board-api.d.ts` out of the required contract gate; it is explicitly a
non-maintained IntelliSense snapshot. `assets/guides/editors/board.md` belongs to US-1492 for
removal of the board switcher entries and is not part of this task.

## Concerns

- **US-1492 overlap:** both tasks touch `src/renderer/editors/board/BoardToolbar.ts`. US-1492 owns
  removing the path click-to-switch popover; US-1493 has no structural dependency on it and must
  rebase whichever version lands second without restoring the `BoardsTreeView`/popover implementation.
- **Host automation boundary:** the existing `BoardEditorFacade.click()`, `type()`, and `select()`
  methods operate on the board iframe. The required element listing/highlighting is host chrome;
  acceptance must verify it through the generic host/window automation surface, not by routing a
  host selector into the iframe.
- **Main-frame authority:** a board can have secondary views, but the page toolbar is singular.
  Only the live permitted main frame can replace or patch its catalog; late, secondary, disposed,
  or old-generation messages are ignored. This is a lifecycle constraint, not a new permission.
- **Focus versus controlled updates:** host-owned values mean `update` can intentionally change an
  input/select value while the user is typing. The keyed reconciler must clamp/restore the caret and
  must not blur surviving controls; menu close must restore the trigger focus where Draw already
  does so.
- **Warnings after disposal:** malformed, duplicate, over-cap, or unknown-update warnings use
  `appendLog("warn", ...)` only while the sending frame is live. After disposal, safe ignore is the
  correct behavior because there is no valid board log target.
- **D5 is visual only:** the separator and spacing communicate ownership in the toolbar; they are
  not a security boundary. Trust remains the existing `isBoardPermitted()` rendering gate.
- **D7 icon handling is deliberately separate from board identity icons:** the existing
  `board-icon-cache.ts` is keyed only by board root and holds one identity icon, so descriptor icons
  require a new board-root-plus-path cache. SVG parsing/rebuilding prevents accidental restyling,
  external loads, and theme drift; it is not a security boundary because a trusted board already
  has `executeNode`.
- **No unresolved design questions remain:** the eight-control cap, all five control types, shared
  value vocabulary, no overflow menu, uncontrolled values, and lifecycle behavior are the resolved
  EPIC-112 decisions. Any implementation deviation must be recorded here as a concern rather than
  silently changing the epic.

## Acceptance Criteria

1. `src/board-shim.ts` exposes `persephone.toolbar.set`, `.update`, and `.onAction`; set/update use
   the same parent post-message target and safe-post behavior as `setSecondaryViews`; action
   callbacks receive a discriminator-free `{ id, type, value? }` object and an idempotent
   unsubscribe function.
2. `src/ipc/board-bridge-channels.ts` contains typed set/update board-to-host messages and the
   `toolbar:control` host-to-board message in `BoardHostFrameMsg`; the bridge version is exactly
   `1.10.0` and both maintained guides agree with it.
3. A permitted main-frame board can render all five fixed catalog types using the named existing
   components: `SwitchView`, `SelectView`, `InputView`, `IconButtonView`, `openMenu`/`MenuHandle`,
   `PopoverView` where needed, and `SwitchWidgetView`. Icon descriptors accept only `{ name }`,
   `{ svg }`, or board-root-relative `{ file }`; names use the registry, SVG is allowlist-rebuilt
   with `DOMParser` and theme-normalized unless `preserveColors: true`, raster uses `<img>`, and
   file paths cannot escape the board root. No new trust permission is accepted.
4. Controls appear in the board identity/children portion of the page toolbar, before
   Persephone’s reload/log/properties right contributions and the editor switch, with a visible
   theme-aware D5 separator. The board webview remains below the toolbar; controls are not iframe
   content. The board path switcher removed by US-1492 is not reintroduced.
5. `set` establishes complete ID/order state, caps rendering at eight with board-log warnings, and
   diffs by ID. Surviving records reuse their DOM/view identity; removed records dispose menus and
   timers; new order is applied without replacing surviving roots.
6. During `set`, a surviving focused control preserves focus; text inputs preserve/clamp caret
   selection; scroll positions on surviving control roots/scrollable descendants are restored. A
   removed focused control does not cause the reconciler to steal focus. `update` patches only
   known IDs, preserves order, rejects structural/type changes, and leaves omitted fields unchanged.
7. User interaction produces the specified values, including menu item IDs and a single 500 ms
   debounced input event. Host-side value changes are immediate, and explicit board updates can
   replace them without requiring an echo.
8. Every live control has the stable `data-name` `board-toolbar-control-${id}` and remains
   listable/highlightable through `BoardEditor.elements`. Dynamic declarations join the existing
   static declarations and disappear when the toolbar is inactive, untrusted, disposed, or between
   frame generations. Host operations do not incorrectly use `BoardEditorFacade`’s iframe-only
   methods.
9. A reload clears the prior catalog before the new frame declares controls; a busy board that
   survives navigate-away retains its work but exposes no stale toolbar controls; reuse requires a
   fresh declaration; frame/page disposal cancels timers, disposes popovers/menus, clears dynamic
   elements, and ignores late messages.
10. `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, and the runtime shim agree
    on schema, events, cap, debounce, icons, trust, lifecycle, and version. The US-1493 entry in
    `doc/active-work.md` links to this document, and no production implementation or commit is part
    of this planning task.

## Files Changed Summary

| File | Change |
|---|---|
| `src/ipc/board-bridge-channels.ts` | Add typed toolbar set/update board-to-host messages and the `toolbar:control` host-to-board event. |
| `src/board-shim.ts` | Add `persephone.toolbar.set`, `.update`, and `.onAction` using existing host-message/posting idioms. |
| `src/shared/board-bridge-version.ts` | Bump the additive bridge contract from `1.9.0` to `1.10.0`. |
| `src/renderer/editors/board/BoardToolbar.ts` | Preserve the existing direct composition, insert the dynamic board-control group between the path and Persephone controls, and retain all published control names. |
| `src/renderer/editors/board/BoardToolbarControls.ts` | New fixed catalog types, normalization, component mapping, event handling, and keyed D3a reconciliation. |
| `src/renderer/editors/board/board-toolbar-icon.ts` | New D7 icon resolver, DOMParser/allowlist SVG sanitizer, board-root path confinement, and board-root-plus-path cache. |
| `src/renderer/editors/board/BoardToolbar.css` | New board-only layout rule for the theme-aware D5 group boundary. |
| `src/renderer/editors/board/BoardWebview.ts` | Receive validated set/update messages, send live control events to the main frame, and clear frame-scoped toolbar state on load/disposal. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Own the transient live catalog/declaration seam without persisting it in restore data. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Merge live board-control declarations into `createElements()`, `elements`, `members`, and highlighting/provisioning. |
| `assets/guides/agents/boards.md` | Document the maintained board authoring contract and bridge version. |
| `assets/board-template/CLAUDE.md` | Keep the template’s board API/version guidance aligned. |
| `doc/active-work.md` | Convert the plain-text US-1493 dashboard entry into a link to this document. |
| `src/renderer/uikit/IconButton/IconButtonView.ts`, `src/renderer/uikit/Popover/PopoverView.ts`, `src/renderer/uikit/Menu/attach-menu.ts`, `src/renderer/uikit/Select/SelectView.ts`, `src/renderer/uikit/Input/InputView.ts`, `src/renderer/uikit/Switch/SwitchView.ts` | No changes; reuse the existing primitives. |
| `src/renderer/editors/base/PageToolbarView.ts`, `src/renderer/editors/base/EditorToolbarView.ts` | No changes; reuse `SwitchWidgetView` from the existing widget module, but do not adopt the `PageToolbarView` shell. |
| `src/renderer/editors/board/board-glyph-element.ts` | No change; reuse the existing board identity marker path. |
| `src/renderer/editors/board/board-icon-cache.ts` | No change to the existing one-icon-per-board-root identity cache; it is not reused for descriptor icons. |
| `src/renderer/editors/draw/index.ts` and `assets/boards/excalidraw/**` | No changes in US-1493; US-1495 migrates Draw’s five controls using this catalog. |
| `src/renderer/editors/board/board-api.d.ts` | No required change; this legacy snapshot is not the maintained contract gate. |
| `src/main/board-bridge.ts`, `src/main/board-protocol-service.ts`, `scripts/dev.mjs`, `scripts/build-prod.mjs` | No changes; the existing bridge build/inline path carries the shim contract. |
| `assets/guides/editors/board.md` | No change in this task; US-1492 owns removal of the board switcher guide entries. |
| Tests or a new test harness | No new harness is specified by this investigation task; verify through the project’s normal typecheck/lint/build gates when implementation is authorized. |
