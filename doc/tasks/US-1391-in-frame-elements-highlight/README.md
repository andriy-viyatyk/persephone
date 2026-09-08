# US-1391 — In-frame elements and highlight

**Status:** Implemented · **Epic:** [EPIC-097](../../epics/EPIC-097.md) · **Roadmap:** step 5

## Goal

Make a trusted board's `app.elements` and `app.highlight()` work against the document that owns
the controls, including a declared secondary view. Give board scripts the DOM helper that is already
available to Persephone's renderer, preserve complete element metadata in the main-frame shape, and
route live visibility/highlight work to the correct board iframe. This document is investigation and
planning only; do not implement or commit it until the user explicitly asks for implementation.

## Background

US-1390 is implemented in the working tree. The board shim already bundles `expose` from
`ai-vision/remote` (`src/board-shim.ts:44-46`), exposes `persephone.aiVision.expose()` and
`schemaVersion` (`src/board-shim.ts:662-670`), registers only from `viewRole === "main"`
(`src/board-shim.ts:317-329`), and answers host `ai:request` messages through the authenticated
`onHostMessage` gate (`src/board-shim.ts:443-452,495-518`). The host already accepts the
registration and correlates `board:aiResult` (`src/renderer/editors/board/BoardWebview.ts:291-433`)
and mounts `.app` through `createRemoteProxy` (`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:344-371`).

The installed package contract was checked rather than inferred:

- `node_modules/ai-vision/dist/dom/elements.d.ts:6-10` requires
  `createElements(declarations, highlightElement, options?)` and returns exactly `{ members, provide }`.
- `node_modules/ai-vision/dist/dom/elements.js:76-84` computes visibility with
  `document.querySelectorAll(selector).some(element => element.offsetParent !== null)`; without a
  document it returns `false`.
- `node_modules/ai-vision/dist/dom/elements.js:86-129` supplies the live `elements` value and the
  `highlight` function through `provide`, using the injected highlight function.
- `node_modules/ai-vision/dist/dom/highlight.d.ts:7-8` exports both `installHighlightOverlay()` and
  `highlightElement(selector, message?, options?, reveal?)`. The implementation at
  `node_modules/ai-vision/dist/dom/highlight.js:2-26` lazily installs the package overlay and calls
  `window.__aiVisionHighlight.show()`.
- `node_modules/ai-vision/dist/remote/expose.js:25-86` already handles `ai:elements` and
  `ai:highlight` by resolving the exposed node and calling its `provide("elements")` or
  `provide("highlight")`. US-1391 does not replace that contract for the main frame.
- `node_modules/ai-vision/dist/core/types.d.ts:44-50` defines `IAiElement` as the normal
  name/purpose/where/selector/visible fields and has no note field. The runtime result is still
  plain enumerable data: `node_modules/ai-vision/dist/core/result-shaper.js:21-32,166-173` copies
  plain-object keys into the shaped value, and `node_modules/ai-vision/dist/remote/expose.js:298-300` sends the
  shaped result without an allow-list. A Persephone-only `visibilityNote` extension therefore
  survives `shapeResult` and the wire response even though it is not added to the package type.
- `node_modules/ai-vision/dist/core/remote-types.d.ts:25-35` already has `view?: string` on
  `IAiRemoteRequest`, but `node_modules/ai-vision/dist/core/types.d.ts:32-42` has no `view` field on
  `IAiElementDeclaration`. The package's `copyElement` (`node_modules/ai-vision/dist/remote/expose.js:190-197`)
  also drops unknown declaration fields. Therefore the current package does not, by itself, carry a
  board element's secondary-view ownership across registration.

The existing frame model supports the required routing. `src/board-shim.ts:74-84` derives a frame's
`viewRole` from the `view` query parameter, and `src/board-shim.ts:672-674` exposes it as
`persephone.view`. `BoardWebview` distinguishes the main frame from secondary frames and assigns
the main/secondary tab ids (`src/renderer/editors/board/BoardWebview.ts:32-38,46-82`); its secondary
iframe URL includes the view id (`src/renderer/editors/board/BoardWebview.ts:153-170`). The secondary
view executes the same board entry script with `isMain: false` (`src/renderer/editors/board/BoardSecondaryView.ts:136-149`).

`BoardEditorModel.frames` is already a live per-tab iframe registry and `loadedTabs` records CDP-ready
frames (`src/renderer/editors/board/BoardEditorModel.ts:150-173`). US-1390 stores only the main
registration (`src/renderer/editors/board/BoardEditorModel.ts:193-237`), intentionally clears it on
main-frame replacement/reload (`src/renderer/editors/board/BoardEditorModel.ts:175-190,623-635`),
and clears it on disposal (`src/renderer/editors/board/BoardEditorModel.ts:650-677`). That single
registration is correct for the shape, but its transport must gain per-frame handlers for this task.

The existing auto-mount path is usable without inventing a second panel mechanism:
`BoardTargetModel.ensureReady()` calls `mountAndWait()` for every secondary request
(`src/renderer/editors/board/BoardTargetModel.ts:135-175`); `mountAndWait()` opens the sidebar and
selects the composite panel key (`:159-164`). The model-level automation wrapper simply delegates to
that target (`src/renderer/automation/operations.ts:362-364`), and the facade already uses it before
frame operations (`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:173-256`). The panel id is
`board-secondary:<viewId>` (`src/renderer/editors/board/board-secondary.ts:1-20`), and
`BoardSecondaryView` mounts the corresponding `BoardWebview` only after the panel is present and the
board is trusted (`src/renderer/editors/board/BoardSecondaryView.ts:108-149`).

### What the roadmap sketch gets right, and what it gets wrong

The sketch in EPIC-097 (`doc/epics/EPIC-097.md:121-128`) is right that the main frame must remain the
only shape-registration point, that every frame runs the same script with a frame-local
`persephone.view`, and that visibility/highlight must execute remotely. It is also right that a
secondary highlight must mount the panel through `BoardTargetModel.ensureReady()` first.

It is incomplete in two concrete ways:

1. The installed package does not understand `declaration.view`; the package type and serializer omit
   it. Persephone must accept `view` as a board-only declaration extension, retain it in a shim-owned
   registry, and decorate the main registration shape with it. `createRemoteProxy` currently retains
   unknown element fields in `sanitizeElements` (`node_modules/ai-vision/dist/core/remote-proxy.js:181-197`),
   so the decorated field can be consumed by the host without forking the package.
2. The current host transport always uses the main registration's request handler, and the current
   shim listener always calls the current exposed root (`src/board-shim.ts:500-505`). Secondary
   requests therefore cannot work merely because a secondary `expose()` happened to run. The shim
   needs a frame-local element registry, and `BoardEditorModel`/`BoardWebview` need a per-frame
   request route. The secondary frame does not register a second `.app` shape.

## Implementation Plan

### 1. Add the board-facing DOM helper to the shim

Update `src/board-shim.ts` beside the existing remote imports and `exposeAiVision()` surface.
Import `createElements` and the package's ready-made `highlightElement` from `ai-vision/dom`.
Use `highlightElement`, not `installHighlightOverlay`: its signature exactly matches the callback
required by `createElements`, it passes the declaration's `message`, options, and reveal request, and
it lazily installs the in-frame overlay only when a highlight is requested. Calling
`installHighlightOverlay()` at shim startup would do unnecessary DOM work in every frame and would
make a board's early script timing more fragile.

The public shim method should be synchronous and preserve the package result exactly:

```ts
// Before — src/board-shim.ts:44-46,662-670
import { AI_VISION_SCHEMA_VERSION, expose } from "ai-vision/remote";

// ...
aiVision: {
    schemaVersion: AI_VISION_SCHEMA_VERSION,
    expose: exposeAiVision,
},

// After — planned
import { AI_VISION_SCHEMA_VERSION, expose } from "ai-vision/remote";
import { createElements as createDomElements, highlightElement } from "ai-vision/dom";

function createBoardElements(declarations: readonly BoardElementDeclaration[]) {
    const result = createDomElements(declarations, highlightElement);
    registerFrameElements(declarations, result.provide);
    return result; // exactly { members, provide }
}

// ...
aiVision: {
    schemaVersion: AI_VISION_SCHEMA_VERSION,
    expose: exposeAiVision,
    createElements: createBoardElements,
},
```

`BoardElementDeclaration` is a shim-local structural extension of the package declaration with
`view?: "main" | string`; the board remains a plain unbundled script, so the runtime accepts the
extra field without claiming that the npm package owns it. The registry must validate one complete
root declaration set per frame, reject duplicate names, and retain the declaration metadata and
`provide` callback. The board author still attaches the returned `members` and `provide` to the
descriptor and separately assigns the declarations to `descriptor.elements`; this is necessary
because the package helper intentionally returns only `{ members, provide }`.

The registry is frame-local. `createBoardElements()` runs independently in the main and secondary
documents because the same `app.js` runs in each; no DOM object crosses the frame boundary. Inside
`postAiVisionRegistration()` (`src/board-shim.ts:317-329`), decorate the result of `remote.describe()`
before posting it: recursively walk the complete shape tree, including each nested `node` member,
each indexed `item` shape, and their descendants, and copy the registry's `view` onto every matching
`node.elements` entry. Preserve all other package fields. This decoration belongs inside that one
registration choke point, so `refresh()` (`src/board-shim.ts:350-354`) re-describes and re-decorates
the same way instead of posting an undecorated shape. The descriptor must include the full
declaration list so the host shape retains `elements`, purposes, `where`, selectors, and
help-search metadata even when a panel is not mounted.

When registration is accepted, validate every declaration's `view` against the board's declared
secondary views before storing the registration. An absent view and `"main"` are valid; every other
value must match a declared secondary id. Report an unknown id through the existing registration
warning sink (`BoardWebview.handleAiVisionRegistration()` passes its warning callback to the model at
`src/renderer/editors/board/BoardWebview.ts:371-392`, which reaches `ui.log`) so a typo is visible as
the board loads. Keep the host-side validation immediately before request routing as a defense in
depth check; registration-time validation is the author-facing diagnostic, not a replacement for it.

Do not change `src/ipc/board-bridge-channels.ts`: `view?: string` already exists on the package-owned
`IAiRemoteRequest` (`src/ipc/board-bridge-channels.ts:19,306-323`), and the registration/result wire
messages already exist. The decorated `view` is an additive field inside the existing shape and is
accepted by the current minimal shape validator (`src/renderer/editors/board/BoardWebview.ts:504-514`).

### 2. Answer element actions from the owning frame and close the rejection hole

Extend the shim's frame-local state near `aiVisionRemote` (`src/board-shim.ts:212-213`) with the
registry needed by `createBoardElements()`. In the `ai:request` listener, retain the existing source
and origin gate and generation check. The main frame keeps the current `remote.handle(request)` path,
which is the package's verified `descriptor.provide()` implementation. A secondary frame handles
`ai:elements` and `ai:highlight` from its own registry instead of trying to resolve the main frame's
exposed root. The local dispatcher should:

1. Resolve the registered helper for the request path (the US-1391 board surface has one exposed
   root registry; reject an absent or ambiguous registry with a normal failed response).
2. For `ai:elements`, call its `provide("elements")` and return the value.
3. For `ai:highlight`, call its `provide("highlight").value(request.name, request.message)` and await
   it. This invokes the package `highlightElement`, so selector lookup, overlay placement, reveal,
   and visibility all happen in the owning document.
4. Catch local provider errors and return `{ ok: false, error }`, using the existing `errMessage`
   helper. Other actions continue through the existing `remote.handle(request)` path; this preserves
   the package's established property/method/children behavior and its own error handling.

The current listener has a real US-1390 review defect:

```ts
// Before — src/board-shim.ts:499-517
void responsePromise.then((response) => {
    if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
    window.parent.postMessage({
        __persephone: "board:aiResult",
        reqId: data.reqId,
        response,
    }, hostPostTarget);
});

// After — planned
void responsePromise
    .then((response) => {
        if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
        window.parent.postMessage({
            __persephone: "board:aiResult",
            reqId: data.reqId,
            response,
        }, hostPostTarget);
    })
    .catch((error: unknown) => {
        if (aiVisionRemote !== remote || aiVisionGeneration !== generation) return;
        const response: IAiRemoteResponse = {
            ok: false,
            error: errMessage(error, "The AiVision request failed."),
        };
        window.parent.postMessage({
            __persephone: "board:aiResult",
            reqId: data.reqId,
            response,
        }, hostPostTarget);
    });
```

The actual implementation must apply the same rejection response to the local-provider branch. A
replacement generation must suppress both success and failure replies, as the current success path
does, so an old frame cannot answer a request belonging to a new registration.

### 3. Register transports for every live frame, while keeping one main shape

Update `src/renderer/editors/board/BoardEditorModel.ts` and
`src/renderer/editors/board/BoardWebview.ts` without changing the persisted board state.

`BoardEditorModel` should retain the existing main `BoardAiVisionRegistration` (shape, main iframe,
generation, token, and warning sink) and add a transient map keyed by `BOARD_CDP_TAB` or
`boardSecondaryPanelId(viewId)`. Each entry contains the live iframe identity and a narrow request
callback owned by its `BoardWebview`. Add set/clear methods with the same stale-iframe identity
checks used by `frames` (`src/renderer/editors/board/BoardEditorModel.ts:175-190`). Clear a secondary
transport on that frame's unmount, reload, or replacement; clear all transports on model disposal.
Do not store this in `BoardEditorState`.

`BoardWebview` should register its request callback for both `isMain` and secondary instances after
the iframe exists, and unregister it in `onDispose` (`src/renderer/editors/board/BoardWebview.ts:100-126`).
Generalize its current `requestAiVision`/pending map (`:394-441`) so the secondary instance can post
`ai:request` to its own `contentWindow` and correlate only results from its own generation, iframe,
and content window. Keep `handleAiVisionRegistration()` main-only (`:371-392`): a secondary
`board:aiVision` message is intentionally not promoted to a host shape.

The model's routed request method should:

- use the main registration's request callback for `view === undefined` or `view === "main"`;
- convert a secondary view id to `boardSecondaryPanelId(view)`;
- verify that the view is declared in `secondaryViewDefs` and reject unknown ids;
- let the facade call `await editor.target.ensureReady(tabId)` before a highlight request, then use
  the registered secondary transport; and
- repeat trust, live-frame, generation, and content-window checks immediately before posting.

This retains the existing security boundary: `BoardWebview.handleMessage` authenticates the board
origin and exact iframe source (`src/renderer/editors/board/BoardWebview.ts:291-297`), and every
transport request repeats `boardTrust.isTrusted()` (`:402-405`).

### 4. Route `highlight` and aggregate `elements` in the board facade

Update `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`. The existing `.app` proxy setup at
`:344-371` should remain the single proxy owner, including `restricted`, warning, and timeout
behavior. Add a route around its `sendAiVision()` callback:

```ts
// Before — src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:357-371
private sendAiVision(request: IAiRemoteRequest) {
    const timeout = resolveBoardCallTimeout(/* existing four levels */);
    return this.editor.requestAiVision(request, timeout.ms, timeoutError);
}

// After — planned
private sendAiVision(request: IAiRemoteRequest): Promise<IAiRemoteResponse> {
    const route = this.resolveBoardElementRoute(request); // main, secondary, or aggregate
    return route.kind === "elements"
        ? this.readElementsAcrossMountedViews(request, route)
        : this.sendToViewAfterReady({ ...request, view: route.view });
}
```

The concrete behavior is:

- For `ai:highlight`, use `request.name` to find the matching decorated declaration in the cached
  main shape. Default no `view` to `"main"`; route an explicit `"main"` to the main frame. For a
  secondary declaration, call `BoardTargetModel.ensureReady(boardSecondaryPanelId(view))` first,
  then post the same request with `view` set. The request's timeout must cover the readiness wait and
  the leaf request; use the existing timeout-level/error formatting from
  `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:357-371`.
- For `ai:elements`, locate the shaped node at `request.path` and group its declarations by view.
  Query the main frame. Query only secondary frames that are already mounted and `loadedTabs`-ready;
  do not call `ensureReady` for a read. For each declaration, use the result from its owning mounted
  frame and preserve the main-frame result for `view === "main"`. For an unmounted secondary view,
  synthesize its entry from the static declaration with `visible: false` and the explicit extra field
  `visibilityNote: 'View "<viewId>" is not mounted; it was not queried. highlight mounts it.'`.
  This distinguishes an unqueried closed panel from a control proven hidden in its own document;
  the distinction is in the element entry, not only in board help. The package's `IAiElement` type
  does not declare that field, but the verified plain-data `shapeResult` path above preserves it.
  Preserve declaration order and return the standard `IAiElement[]` fields plus this Persephone
  extension.
- If a mounted secondary is still loading, treat it like not-ready for this non-mounting read and
  return `visible: false` with the same `visibilityNote` naming the view and saying it was not
  queried; highlight remains the operation that opens/loads it. A future implementation may wait
  for an already-open frame, but it must not mount a closed one merely to answer a read.
- Validate view ids against the board's declared secondary views before routing. Never let a board
  declaration select an arbitrary iframe or a frame belonging to another page.

`createRemoteProxy` emits one `ai:elements` request, so the resolved four-level timeout is one
budget for the whole aggregation, not a fresh timeout per frame. Resolve it once, carry one
deadline/remaining budget through the main and mounted-secondary requests, and reject the aggregate
if that deadline expires; do not spend N times the board's 30-second budget. The timeout error must
name the aggregate operation and level, for example `AiVision elements aggregation timed out at
level <level> (<label>) while querying views: main, notes`, rather than reporting a misleading
single-frame timeout. Highlight keeps the same resolved budget over readiness plus its one leaf
request.

The host-side result still uses the package's `ai:elements`/`ai:highlight` response contract. The
`view` field is routing metadata only; it is not exposed as a new package engine field. `$help` and
`helpSearch` continue to use the static declarations in the main shape through the existing proxy
(`node_modules/ai-vision/dist/core/remote-proxy.js:17-33`), so unmounted panels remain discoverable.

### 5. Update the trusted scratch board as the verification surface

Do not touch `persephone-boards/boards/todo`; that belongs to EPIC-098. Use the trusted board at
`C:\projects\test-boards\aivision-probe`. Its `board-manifest.json` already declares `notes`, and
`index.html:17-31` already supplies `data-name` controls in the main and notes markup. The plan's
exact declarations to add to `app.js` are:

```js
var elementDeclarations = [
    { name: "new-item", purpose: "Enter a new item title.", view: "main" },
    { name: "add-item", purpose: "Add the typed item.", view: "main" },
    { name: "clear-done", purpose: "Remove completed items.", view: "main" },
    { name: "filter", purpose: "Filter the visible items.", view: "main" },
    { name: "item-list", purpose: "The visible item list.", view: "main" },
    { name: "notes-box", purpose: "Edit notes for the secondary view.", view: "notes" },
];
```

Place these declarations and the existing members in named variables before the descriptor at
`app.js:83`, then assemble one object literal without mutating it afterward:

```js
var appMembers = [
    { name: "filter", kind: "property", writable: true, summary: "Substring filter applied to the item list." },
    { name: "list", kind: "property", node: true, indexable: true, summary: "The filtered items; index it as list[0]." },
    { name: "addItem", kind: "method", signature: "addItem(title: string)", summary: "Append an item and return it." },
    { name: "toggleItem", kind: "method", signature: "toggleItem(id: number)", summary: "Flip one item's done flag." },
    { name: "clearDone", kind: "method", signature: "clearDone()", summary: "Remove every done item; returns how many went." },
    { name: "slowTask", kind: "method", signature: "slowTask(ms: number)", summary: "Sleep, then answer. No declared timeout." },
    { name: "declaredSlowTask", kind: "method", signature: "declaredSlowTask(ms: number)", summary: "Sleep, then answer. Declares timeoutMs: 1500.", timeoutMs: 1500 },
];
var elementParts = window.persephone.aiVision.createElements(elementDeclarations);

model.aiVision = {
    kind: "ProbeApp",
    summary: "A scratch board object model for EPIC-097 verification.",
    help: "The probe board's own object model; elements include main controls and notes-box.",
    members: appMembers.concat(elementParts.members),
    elements: elementDeclarations,
    provide: elementParts.provide,
    summarize: function () { return { kind: "ProbeApp", items: items.length, filter: model.filter }; },
};
```

In the actual board edit, the member array, declarations, and helper result are all assembled before
the single descriptor literal. In each frame, branch the already-loaded page on
`window.persephone.view`:
the main frame shows `#main-view`, while the `notes` frame shows `#notes-view`; otherwise the notes
declaration would be correctly routed to a document whose control is still `hidden`.
Expose the model after this descriptor setup as it does today (`app.js:129-131`). Because the same
script runs once in each frame (`src/board-shim.ts:74-84,672-674`), both frames populate their own
element registry; only the main frame posts the decorated shape.

Manual verification against this board must cover:

- main `app.elements` returns the five main declarations with live visibility;
- `helpSearch` finds both `notes-box`'s purpose and the existing root help before the notes panel is
  opened;
- `app.highlight("notes-box")` expands `board-secondary:notes`, posts to the notes iframe, and draws
  the overlay in that iframe's document;
- reading `app.elements` before opening notes does not expand the sidebar and reports
  `notes-box.visible === false` with a `visibilityNote` naming `notes` and saying it was not queried;
  after the panel is mounted, the note disappears and it reports the notes control's live visibility;
- `app.highlight("add-item")` and `app.highlight("filter")` stay in the main iframe; and
- a rejection from a provider returns a failed `board:aiResult` promptly rather than leaving the
  host waiting for its timeout.

### 6. Measure the shim after the implementation

US-1390 measured the served inline shim at 77,967 bytes uncompressed / 22,525 gzip, from a
46,591-byte unwrapped pre-remote baseline (`doc/tasks/US-1390-board-ai-vision-proxy/README.md:285-300`).
Adding the DOM imports is not byte-neutral: an in-memory Vite IIFE probe using the current
`src/board-shim.ts`, `createElements`, and `highlightElement` produced 97,458 unwrapped bytes /
27,957 gzip and 97,496 served bytes / 27,986 gzip. This probe intentionally forced both imports to
remain reachable and is a lower bound; the registry/routing code will add its own bytes.

Relative to US-1390's 22,525 gzip, this is about +5.4 kB gzip, or roughly 28 kB gzip inlined into
every served board document, including each secondary-view document. About 13 kB of the added
uncompressed payload is the overlay source itself.

The rejected alternative was for the host to inject `highlightOverlaySource` into the board frame
through the existing CDP `evaluate` path in `src/renderer/automation/operations.ts`. That would keep
the overlay out of every board document, but it makes this path depend on CDP when CDP may be
unavailable and splits a mechanism that the library deliberately keeps together. Decision 5 is
therefore settled on the in-frame bundle for library consistency and CDP independence; the honest
planning number is the measured roughly 28 kB gzip, not byte neutrality. After implementation, run
the production board-shim build and record exact unwrapped and served values (including the
`<script>` wrapper from `src/main/board-protocol-service.ts:137-145`) so EPIC-097 decision 5 can use
The production measurement after implementation is **100,724 unwrapped bytes / 28,670 gzip** and
**100,762 served bytes / 28,698 gzip**, including the 38-byte `<script>` wrapper from
`src/main/board-protocol-service.ts:137-145`. The shim contains no `</script` sequence requiring
the serving escape, so the served measurement is the exact production fragment. Do not introduce a
lazy network-loaded module: the shim must remain synchronous before an unbundled board `app.js`
runs.

## Concerns

These decisions are resolved before implementation:

- **Package `view` gap:** keep the package dependency unchanged. A Persephone-only declaration
  extension plus shim shape decoration is required because the installed package type and serializer
  omit `view`; do not edit `node_modules` or recreate the package engine.
- **One shape, many documents:** only the main frame registers a shape. Secondary frames register no
  host shape, but their shims retain their own DOM helper and answer routed element actions locally.
  `persephone.state` remains the existing shared-state mechanism; this task does not make a secondary
  model authoritative for `.app` values.
- **Unmounted visibility:** a closed secondary panel has no live iframe document, so `elements` must
  report `visible: false` without opening the panel and add `visibilityNote` naming the unmounted
  view and saying it was not queried. `highlight` is the explicit operation that mounts it.
- **Element aggregation:** `createRemoteProxy` emits one `ai:elements` request, so the host must
  aggregate per-view results rather than expect the library to broadcast. One resolved four-level
  timeout is the budget for the whole aggregation; its timeout error must say that the aggregate
  timed out and name the level and views, rather than implying N independent frame budgets. It must
  preserve the package result fields and not run DOM queries in the cross-origin host renderer.
- **Overlay timing:** use `highlightElement` as the injected callback. It installs the overlay lazily
  in the target frame and returns the package result; no overlay source string or host DOM access is
  added to the protocol.
- **Stale frames and trust:** every per-frame transport needs the existing iframe/content-window /
  generation checks and trust gate. A late success or failure from an old frame must be ignored.
- **Scope:** no unit tests, test harness, todo-board implementation, browser-page proxy, guide, or
  board API typing is part of US-1391. Those remain in the epic's other tasks.

## Files that need NO changes

- `src/ipc/board-bridge-channels.ts` — registration/result messages and `IAiRemoteRequest.view` are
  already present (`:19,306-323`); no new wire action is needed.
- `src/renderer/editors/board/BoardTargetModel.ts` — its existing `ensureReady()` / `mountAndWait()`
  path already opens and activates a declared secondary panel (`:135-175`).
- `src/renderer/automation/operations.ts` — `ensureTargetReady()` already delegates to the target
  (`:362-364`).
- `src/renderer/editors/board/board-secondary.ts` — the stable `board-secondary:<viewId>` mapping
  already exists (`:1-20`).
- `src/renderer/editors/board/BoardSecondaryView.ts` — it already creates the secondary
  `BoardWebview` with `isMain: false` and the declared view id (`:136-149`); only the transport/model
  it registers must change.
- `src/renderer/editors/board/BoardEditorView.ts` — existing reload/trust branch identity owns the
  main frame lifecycle (`:157-165`); it should not become a routing layer.
- `src/main/board-protocol-service.ts` — it already inlines whatever `board-shim.js` the build emits
  (`:118-145`); no serving-path change is needed.
- `C:\projects\ai-vision\src` and `node_modules\ai-vision` — the package is the adopted dependency;
  do not fork or patch it for this task.
- `persephone-boards/boards/todo`, `assets/guides/`, `board-api.d.ts`, browser editor files, and QA
  harness directories — explicitly out of scope for US-1391.

## Acceptance Criteria

- `persephone.aiVision.createElements(declarations)` is synchronously available to every trusted
  board frame, returns the package's `{ members, provide }`, and binds the package
  `highlightElement` callback to that frame's overlay.
- A board can attach those members/provided values and its declaration list to the exposed root; the
  main registration shape contains every declaration, purpose, selector/where metadata, and
  `view` routing metadata, so `.app.$help` and `helpSearch` discover main and secondary controls.
- Main-frame `ai:elements` and `ai:highlight` continue to resolve through the package remote's
  descriptor provider; secondary-frame actions are answered by the receiving frame's local element
  registry and never by a host-side DOM query.
- `highlight` for a secondary declaration calls `ensureReady()` before posting to that view's iframe,
  and the overlay is visible in that iframe's document. Main declarations never route to a secondary.
- `elements` computes `visible` in the owning document. It does not mount a closed secondary panel;
  its declarations report `visible: false` plus a `visibilityNote` naming the view and saying it was
  not queried until the panel is mounted. Mounted secondary results replace the synthetic entries.
- Registration decorates every nested `node` and indexed `item` shape recursively, and `refresh()`
  uses the same `postAiVisionRegistration()` decoration choke point; no nested declaration loses
  its `view` metadata.
- Unknown declaration views are warned through the registration `ui.log` sink when the board loads,
  while host-side validation remains in place immediately before routing.
- Registration remains main-only; secondary frames have per-frame request transports but do not add a
  second `.app` shape or overwrite the main registration. Trust, frame identity, generation, and
  origin checks reject stale/untrusted traffic.
- The `ai:request` promise chain has a rejection handler that posts `{ ok: false, error }` with the
  original `reqId`, for both remote and local-provider failures; stale generations suppress the reply.
- The final production measurement records the unwrapped and served IIFE byte/gzip sizes and confirms
  the DOM helper/overlay cost; no test harness or product implementation is included in this planning
  task, and no commit is created.

## Files Changed summary

| File | Planned change |
|---|---|
| `src/board-shim.ts` | Import `ai-vision/dom`, expose `createElements`, keep a frame-local element registry, decorate the main shape with `view`, route local element actions, and add the `ai:request` rejection reply. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Add transient per-frame AiVision transports and route/clear them with live iframe generations while retaining one main registration shape. |
| `src/renderer/editors/board/BoardWebview.ts` | Register secondary-frame transports, post/correlate per-frame requests, and preserve main-only shape registration and stale-frame checks. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Resolve declaration views, aggregate `ai:elements` across already-mounted frames, and ensure/mount the target view before `ai:highlight`. |
| `C:\projects\test-boards\aivision-probe\app.js` | Verification-only board edit: add the six exact declarations, attach `createElements` to the root descriptor, and branch rendering on `persephone.view`. |
