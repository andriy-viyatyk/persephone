# US-1479: `capabilities` manifest axis, widened registry, and AiVision discovery

## Goal

Land Wave 1 of [EPIC-108](../../epics/EPIC-108.md): make trusted board capability declarations
discoverable and indexable without implementing intent dispatch. This task owns the manifest axis,
the wire-contract seam for US-1480/US-1481, the renderer-local capability index and D4 resolver,
board-origin registration/release, disclosure surfaces, public type mirrors, and the read-only
`capabilities` AiVision namespace.

## Background

The source was inspected on 2026-09-20. EPIC-108 decisions D1-D10 are binding; this task is the
epic's Wave 1 task and its task table entry already exists under the Active EPIC-108 block in
`doc/active-work.md`.

### Current manifest and normalizer

`src/renderer/editors/board/board-manifest.ts` has one flat `BoardManifest` interface and a
forward-compatible `readBoardManifest()` that parses an object without rejecting unknown fields.
It already declares `permissions?: string[]`, and its JSDoc already names `service`,
`contentProviders`, and `capabilities` as known disclosure values while preserving unknown
non-empty permission strings through `normalizePermissions()`. The new field belongs beside
`contentProviders` and must remain trust-neutral in this parser.

`normalizeContentProviders()` is the ingress pattern to follow: non-array input becomes `[]`,
non-object entries are ignored, strings are trimmed, schemes are lowercased/colon-stripped and
deduplicated, and a non-empty but registry-invalid provider type is retained for the registry to
refuse with a readable reason. Validation is intentionally in the consumer, not in the manifest
normalizer. `normalizeCapabilities()` must preserve the same separation: normalize shape and
presentation fields, but leave id/version validity to the capability registry so every malformed
declaration can reach `CustomEditorRegistrationIssue`.

### Current capability service and built-ins

`src/renderer/api/capabilities.ts` currently seeds a module-level `Map` once from
`editorRegistry.getAll()`. Its private key is `id:representation`, because the existing
`content.view` handlers are selected by the payload's representation. The class has exactly four
typed `invoke()` overloads (`text.open`, `content.view`, `image.edit`, and `diagram.edit`) and an
implementation signature that accepts the closed `CapabilityId` union. There are no discovery
methods, no origin/priority/version/board metadata, no board registration or unregistration, and
no request transport.

The built-in declarations already exist on `EditorDefinition.capabilities` and are copied from the
`EDITOR_ROWS` table in `src/renderer/editors/register-editors.ts`; this task must consume that
existing table rather than add a second built-in declaration source. The current representation-keyed
built-in dispatch remains necessary for the four shipped overloads. The new open-id index is an
additional candidate/metadata index; it must not replace the compatibility lookup or alter the
existing handler payload/result behavior.

There are 23 `app.capabilities.invoke` call sites in the source, spread across browser context
actions and browser model actions, SVG/Image/Mermaid editors, response/log/markdown/grid helpers,
clipboard handling, `PagesLifecycleModel`, the MCP inspector, and the draw editor. The eight count
belongs to the eight built-in capability declarations, not to invocation call sites. Every literal
call site's overload resolution must continue to typecheck. EPIC-108's rule is therefore additive:
retain the four overloads and put a general `(id: string, payload: unknown, opts?)` signature
beneath them.

### Current board rebuild and the revocation invariant

`src/renderer/editors/board/custom-editor-registry.ts` owns trusted board manifest consumption.
`CustomEditorRegistry.refresh()` reads `boardTrust.listPaths()` in trusted-list order, applies the
bridge compatibility gate, accumulates registrations while reading manifests, then commits the
rebuild synchronously after its generation guard. It currently calls:

```ts
unregisterBoardProviders(roots);
unregisterBoardSchemes(roots);
```

The implementation of `unregisterBoardProviders()` removes every registration whose origin is
`"board"`; its `roots` argument exists for release bookkeeping/toast cleanup, not as a filter over
the currently trusted list. Capability release must use the same board-origin-set semantics:
`unregisterBoardCapabilities(roots)` must remove all board-origin capability entries before the
new trusted declarations are registered. It must never remove by iterating only the trusted roots.

This distinction is load-bearing. During an untrust refresh, the untrusted board is absent from
`boardTrust.listPaths()`, so a release keyed by that list cannot name the stale registration. The
board-origin set is the authoritative teardown key; the trusted list is only the next rebuild input.
This is the revocation-shaped defect called out in EPIC-108 D9.

`CustomEditorRegistrationIssue` currently carries `boardRoot`, `kind: "provider" | "scheme"`,
`name`, `reason`, and an optional `owner`. It is already copied into Board Info and updated
reactively when the custom-editor registry changes. Capability refusals must extend this same path,
not create a second diagnostic channel.

### Current disclosure and public mirrors

The three existing trust flows are:

- `BoardEditorView.trustBoard()` reads the manifest and calls `showTrustBoardDialog()`.
- `boards.registerBoard()` in `src/renderer/api/boards.ts` reads the manifest and calls the same
  dialog. This file is explicitly protected by US-1479 and must not change.
- `BoardInfoEditorModel.register()` reads the manifest and calls the same dialog.

`TrustBoardDialogProps` currently contains `boardPath`, normalized `permissions`, and the boolean
`serviceDeclared`. `TrustBoardDialogView` renders those values in one declaration panel, and
`src/renderer/scripting/ai-vision/dialogs/trust-board.ts` mirrors them through getters.

`BoardInfoEditorModel.loadProperties()` builds `BoardPropsInfo` from the local manifest and the
custom-editor registry. `BoardInfoEditorView.renderProperties()` already places Permissions,
Content providers, and Registration warnings in the metadata panel. The model snapshot is copied by
`src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` into the public
`IBoardInfoProperties` contract. Separately, `BoardEditorFacade.copyManifest()` copies the manifest
into `IBoardManifest` for `page.editor.getManifest()`.

### Current AiVision registration

`src/renderer/scripting/ai-vision/namespaces/index.ts` registers the renderer Object Model
namespaces with `registerAiVisionFor()`. `namespaces/boards.ts` is the relevant simple pattern:
it defines a fixed `IAiMember[]`, returns a descriptor over the runtime instance, and exposes only
the intended read/write members. A new `namespaces/capabilities.ts` must register the runtime
`capabilities` instance but expose only read-only `list()` and `handlers(id, filter?)`; it must not
expose registration methods or the future invocation transport through this namespace.

### Contract boundary with Wave 2

`src/ipc/module-service-channels.ts` is the wire-contract model: constants, unions, message
interfaces, and no implementation imports. The new
`src/ipc/capability-bus-channels.ts` must follow that shape and export exactly the names pinned by
EPIC-108's “seam between US-1480 and US-1481” section. US-1480 consumes
`CapabilityTransport`; US-1481 supplies the board-side implementation. This task must not create a
`capability-bus.ts` implementation or modify the board bridge/shim.

## Implementation Plan

### 1. Add the manifest declaration and normalizer

In `src/renderer/editors/board/board-manifest.ts`:

- Add the named manifest type with exactly these fields:

  ```ts
  export interface BoardCapabilityDeclaration {
      id: string;
      version?: number;
      priority?: number;
      accepts?: string[];
      payloadSchema?: unknown;
      title?: string;
  }
  ```

- Add `capabilities?: BoardCapabilityDeclaration[]` to `BoardManifest` beside
  `contentProviders`. Keep the existing Permissions JSDoc vocabulary, including
  `"capabilities"`; do not whitelist or filter permission values.
- Add exported `normalizeCapabilities(raw: unknown): BoardCapabilityDeclaration[]` in the same
  normalizer section as `normalizeContentProviders()`. Follow that function's object/array shape,
  trimming and ordered de-duplication conventions. Preserve declaration records whose id is
  non-empty but syntactically invalid (for example an id containing `@`) and preserve an object
  whose id normalizes to `""` because EPIC-108 explicitly requires an empty-id refusal to be
  readable. Do not reject on id whitespace, `@`, version, priority, or payload schema in this
  function.
- Normalize only representation data: trim `id` and `title`, retain an optional numeric
  `version`/`priority` without coercing it, trim and deduplicate non-empty `accepts` strings in
  declaration order, and keep `payloadSchema` opaque. Ignore non-object/array entries and
  non-string `accepts` items. The registry, not this normalizer, decides whether a declaration is
  usable.

Before → after manifest shape:

```ts
// Before
export interface BoardContentProviderDeclaration {
    type: string;
    schemes?: string[];
}

export interface BoardManifest {
    // ...
    contentProviders?: BoardContentProviderDeclaration[];
}

// After
export interface BoardCapabilityDeclaration {
    id: string;
    version?: number;
    priority?: number;
    accepts?: string[];
    payloadSchema?: unknown;
    title?: string;
}

export interface BoardManifest {
    // ...
    contentProviders?: BoardContentProviderDeclaration[];
    capabilities?: BoardCapabilityDeclaration[];
}
```

### 2. Add the exact capability-bus wire contract

Create `src/ipc/capability-bus-channels.ts`. It must have no imports from renderer, main, board,
or implementation modules. Export only the following names and keep their shapes aligned with the
EPIC-108 seam:

```ts
export const MAX_INTENT_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_INTENT_DEPTH = 8;
export const INTENT_DEADLINE_MS = 10_000;
export const MAX_OUTSTANDING_INTENTS_PER_HANDLER = 32;

export type CapabilityErrorCode =
    | "no-handler"
    | "untrusted"
    | "handler-closed"
    | "crashed"
    | "cancelled"
    | "timeout"
    | "cycle"
    | "payload-too-large"
    | "busy"
    | "rejected";

export type CapabilityOrigin = "platform" | "board" | "script";

export interface CapabilityDeclaration {
    id: string;
    version: number;
    priority: number;
    accepts?: string[];
    payloadSchema?: unknown;
    title?: string;
    /** A winning headless declaration is out of scope here and settles as no-handler; service-backed
     *  headless routing belongs to a later phase. */
    headless?: boolean;
}

export type CapabilityRegistration = CapabilityDeclaration & {
    handlerKey: string;
    origin: CapabilityOrigin;
    boardRoot?: string;
};

export interface IntentRequest {
    requestId: string;
    id: string;
    version?: number;
    payload: unknown;
    chain: string[];
    depth: number;
    deadlineAt: number;
}

export interface IntentSettlement {
    requestId: string;
    result?: unknown;
    error?: { code: CapabilityErrorCode; message: string };
}

export interface CapabilityTransport {
    /** Dispatch to a board handler; resolves when the board settles, rejects with a typed code. */
    dispatch(registration: CapabilityRegistration, request: IntentRequest): Promise<unknown>;
    /** Best-effort cancel for a request already dispatched. Never throws. */
    cancel(registration: CapabilityRegistration, requestId: string): void;
    /** The chain/depth currently in force for a page, for D6. 0-length when idle. */
    chainForPage(pageId: string | undefined): { chain: readonly string[]; depth: number };
}
```

Do not add an exported auxiliary error interface, transport implementation, renderer import, or
`capability-bus.ts`; the parallel Wave 2 tasks compile against these names.

### 3. Widen the capability index without changing invocation behavior

In `src/renderer/api/types/capabilities.d.ts` and its exact flat copy
`assets/editor-types/capabilities.d.ts`:

- Change `CapabilityId` from the four-string union to `string`.
- Add public read-only metadata types for an indexed candidate: `id`, `version`, `priority`,
  `origin`, optional `boardRoot`, and the declaration metadata (`accepts`, `payloadSchema`, and
  `title`). Use the public type's `CapabilityOrigin` union (`"platform" | "board" | "script"`).
- Add the optional handler filter used by the roadmap and D4's `accepts` rule:
  `{ mime?: string }`. A filter must exclude a candidate only when it has an `accepts` list and
  the requested value is not accepted; an absent filter does not exclude candidates. Keep the
  filter read-only and serializable.
- Add `list()` for the complete flat candidate/index snapshot and `handlers(id, filter?)` for
  candidates of one bare id. Both are read-only snapshots and must not activate a handler page.
- Preserve the four typed overloads exactly, then add the general
  `invoke(id: string, payload: unknown, opts?: ...): Promise<unknown>` signature beneath them.
  The option bag is the additive version/filter input consumed by the later lifecycle task; its
  addition must not weaken overload selection for the current internal callers.

In `src/renderer/api/capabilities.ts`:

- Replace the closed-id-only registration metadata with an in-memory candidate index whose stored
  ids are bare strings. Defaults are version `1` and priority `50` for both platform and board
  entries. Store `origin`, `boardRoot`, `handlerKey`, `accepts`, `payloadSchema`, `title`, and the
  normalized declaration metadata needed by `list()`/`handlers()`.
- Keep the existing representation-keyed built-in callable map for `content.view` and the other
  four typed handlers. Seed its metadata from the existing `editorRegistry.getAll()` declarations,
  using `origin: "platform"`, `handlerKey: editor definition id`, `version: 1`, and `priority: 50`.
  Do not add a second editor declaration table and do not route built-ins through
  `CapabilityTransport`.
- Avoid an import-cycle seed defect. `custom-editor-registry.ts` is imported while
  `register-editors.ts` is still registering editor definitions; therefore built-in seeding must
  be lazy/idempotent rather than a module-top-level `editorRegistry.getAll()` snapshot. Ensure the
  platform candidates exist before any list/handlers/registration/resolution operation, after the
  editor table has been registered.
- Add internal registration and release functions used by the custom-editor rebuild. Registration
  must return an accepted/refused result with a readable reason and optional incumbent owner so a
  caller can create `CustomEditorRegistrationIssue` entries. Board release must delete every
  `origin === "board"` entry while leaving `platform` entries untouched; preserve the `roots`
  argument for the same owner/release bookkeeping shape as the provider registry, but do not use
  the currently trusted roots as the deletion predicate.
- Implement one central ordering/resolution helper. It must:
  - reject ids that are empty, contain whitespace, or contain `@`; keep the stored id bare;
  - default an omitted version to `1` and refuse a supplied non-integer version;
  - default an omitted priority to `50` and compare numeric priority strictly;
  - allow duplicate ids across boards and keep all candidates visible;
  - keep platform candidates ahead of board candidates on an exact priority tie;
  - keep two board candidates in trusted-list/registration order on an exact tie;
  - filter by exact pinned version when supplied; an unpinned request matches all versions;
  - apply the optional `accepts` filter before ordering;
  - leave `payloadSchema` unvalidated and only store/surface it;
  - retain losers in `handlers(id, filter?)`.
- Keep `@version` parsing at the bus boundary as D4 requires. The registry stores `id` and
  `version` separately; US-1480 will pass the parsed version into the resolver. The task does not
  implement dispatch, deadlines, cancellation, typed rejection settlement, or board-page opening.

Before → after public service contract:

```ts
// Before
export type CapabilityId = "text.open" | "content.view" | "image.edit" | "diagram.edit";

export interface ICapabilities {
    invoke(id: "text.open", payload: TextOpenPayload): Promise<CapabilityPageResult>;
    invoke(id: "content.view", payload: ContentViewPayload): Promise<CapabilityPageResult>;
    invoke(id: "image.edit", payload: ImageEditPayload): Promise<CapabilityPageResult>;
    invoke(id: "diagram.edit", payload: DiagramEditPayload): Promise<DiagramEditResult>;
}

// After (metadata names may be private to the declaration file, but these fields are public)
export type CapabilityId = string;

export interface ICapabilities {
    invoke(id: "text.open", payload: TextOpenPayload): Promise<CapabilityPageResult>;
    invoke(id: "content.view", payload: ContentViewPayload): Promise<CapabilityPageResult>;
    invoke(id: "image.edit", payload: ImageEditPayload): Promise<CapabilityPageResult>;
    invoke(id: "diagram.edit", payload: DiagramEditPayload): Promise<DiagramEditResult>;
    invoke(id: string, payload: unknown, opts?: CapabilityInvokeOptions): Promise<unknown>;
    list(): readonly CapabilityInfo[];
    handlers(id: string, filter?: CapabilityHandlerFilter): readonly CapabilityInfo[];
}
```

The final implementation must use stable, descriptive names for `CapabilityInfo`,
`CapabilityHandlerFilter`, and `CapabilityInvokeOptions` in the declaration file and copy them
byte-for-byte to `assets/editor-types/capabilities.d.ts`. The public `CapabilityInfo` must not
expose a callable function or mutable registry handle.

In `src/renderer/editors/mermaid/MermaidEditor.ts`, fix the overloaded-function `ReturnType`
landmine created by the new general signature. Import `DiagramEditResult` from
`../../api/types/capabilities` and replace the derived variable type before the existing
`diagram.edit` call:

```ts
// Before
let result: Awaited<ReturnType<typeof app.capabilities.invoke>>;

// After
let result: DiagramEditResult;
```

`ReturnType` resolves to the last overload, so leaving the current line after adding the general
`Promise<unknown>` overload would make `result` unknown and break the existing `status`, `message`,
and `imageOnly` reads.

### 4. Register and release trusted board declarations in the existing rebuild

In `src/renderer/editors/board/custom-editor-registry.ts`:

- Add `"capability"` to `CustomEditorRegistrationIssueKind`.
- Add capability registration intents to the local refresh collections. For each bridge-compatible
  trusted manifest, run `normalizeCapabilities(manifest?.capabilities)` before the existing custom
  editor association branch. A board with no `fileMasks`, `contentMasks`, or folder association
  must still register capabilities; do not put capability registration after the `if (!assoc)
  continue` path.
- Validate/register each declaration independently through the capability index. Use the board's
  original root as `boardRoot`, `origin: "board"`, default declaration metadata from the index,
  and a stable handler key based on the existing `boardEditorId(root)` identity. Continue after a
  refusal so one malformed or losing declaration cannot block other declarations from the same
  board. Record each refusal with `kind: "capability"`, the declaration id (including an explicit
  empty-id marker in the display path), the registry reason, and the incumbent owner when there is
  one.
- Preserve the current bridge compatibility gate before all trusted registration work. Preserve
  the generation guard and do not mutate capability state while asynchronous manifests are being
  read.
- In the synchronous commit block, add capability release beside the existing provider/scheme
  release, then register the accumulated capability intents in trusted-list order:

  ```ts
  // Before
  unregisterBoardProviders(roots);
  unregisterBoardSchemes(roots);
  replaceProviderDeclarations(providerDeclarations);

  // After
  unregisterBoardProviders(roots);
  unregisterBoardSchemes(roots);
  unregisterBoardCapabilities(roots); // releases the complete board-origin set
  replaceProviderDeclarations(providerDeclarations);
  // register accumulated capability declarations in trusted-list order
  ```

- The release must be keyed by the registry's board-origin set, not by `roots`. `roots` is the
  snapshot used to rebuild and may already exclude the board that was just untrusted. This is the
  exact D9 invariant and must be called out in the implementation comment.
- Update the state in the same rebuild so Board Info's existing reactive subscription sees the
  capability refusal list without a second async refresh. Keep platform registrations seeded from
  the editor registry and never remove them during board refresh.

### 5. Expose the manifest and refusal data in Board Info

In `src/renderer/editors/board-info/BoardInfoEditorModel.ts`:

- Import `normalizeCapabilities` and `BoardCapabilityDeclaration`.
- Add `capabilities?: BoardCapabilityDeclaration[]` to `BoardPropsInfo` and populate it from the
  local manifest in `loadProperties()`, alongside `contentProviders` and `registrationIssues`.
  Preserve normalized malformed declarations for disclosure; do not show only successfully
  registered entries.

In `src/renderer/editors/board-info/BoardInfoEditorView.ts`:

- Add a `Capabilities` metadata section alongside the existing Content providers and Registration
  warnings sections. Render each declaration's id, effective/default version and priority, optional
  title/accepts data, and an opaque schema indicator if present; keep the text readable for empty
  or malformed ids. This is disclosure, not schema validation or invocation UI.
- Extend registration-warning formatting so `kind: "capability"` is labeled Capability rather
  than falling through to the current Provider/Scheme ternary.

In `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` and
`src/renderer/api/types/board-info-editor.d.ts`, add the capability declaration snapshot to the
public properties facade, copying fresh arrays/objects just as Content providers are copied. Add
the same declaration to `assets/editor-types/board-info-editor.d.ts`.

Before → after refusal label:

```ts
// Before
issue.kind === "provider" ? "Provider" : "Scheme"

// After
issue.kind === "provider"
    ? "Provider"
    : issue.kind === "scheme" ? "Scheme" : "Capability"
```

### 6. Add capabilities disclosure to the trust dialog without touching the protected API file

In `src/renderer/ui/dialogs/TrustBoardDialog.ts`:

- Add a `capabilities` read-only ID list to the dialog state and expose it through the dialog
  helper. The row is disclosure only; it must not grant anything, validate declarations, or imply a
  permission boundary beyond EPIC-108 D8.
- `BoardEditorView.trustBoard()` and `BoardInfoEditorModel.register()` already have the manifest
  in hand; pass normalized capability IDs from those two paths.
- Do not edit `src/renderer/api/boards.ts`, which is explicitly owned by the parallel bridge work.
  Its existing call still supplies only permissions/service. Make the dialog helper accept an
  omitted capability list and backfill it from `readBoardManifest(boardPath)` plus
  `normalizeCapabilities()` before creating `TDialogModel`. This preserves the protected caller
  while making all three trust paths disclose the same IDs.

In `src/renderer/ui/dialogs/TrustBoardDialogView.ts`, add a `Capabilities: ...` row in the existing
declaration panel, using the current UIKit text/panel token patterns and displaying an explicit
placeholder for an empty malformed id. Keep the full-privilege warning, review guidance, and trust
buttons unchanged.

In `src/renderer/scripting/ai-vision/dialogs/trust-board.ts`, add the read-only `capabilities`
member and getter, mirroring the live `TrustBoardDialogProps` state. Do not expose a trust action
or any registration detail through this adapter.

### 7. Preserve the public board manifest mirror

In `src/renderer/api/types/board-editor.d.ts`, add the public read-only capability declaration and
`capabilities` field to `IBoardManifest`; copy the changed file to
`assets/editor-types/board-editor.d.ts`.

In `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`, extend `copyManifest()` to copy every
capability declaration field into fresh declaration objects, including `payloadSchema` as an
opaque value. Keep the existing malformed-manifest guard and existing secondary-view/provider
copy behavior. This ensures `page.editor.getManifest()` does not silently omit the new axis.

### 8. Register the read-only AiVision namespace

Create `src/renderer/scripting/ai-vision/namespaces/capabilities.ts` following the simple
`namespaces/editors.ts`/`namespaces/boards.ts` descriptor pattern:

- Import the runtime `capabilities` service and its public types.
- Advertise only `list()` and `handlers(id: string, filter?)` in the `IAiMember[]`; both are
  properties/methods with no caution because they do not mutate state or open pages.
- Return a descriptor with a concise kind/summary/help and a summary that identifies the current
  candidate count. Do not advertise `invoke`, internal registration, unregistration, handler
  functions, or transport methods.

In `src/renderer/scripting/ai-vision/namespaces/index.ts`, import the descriptor and runtime
`capabilities` service and add one `registerAiVisionFor(capabilities, describeCapabilities)` row
near the other API namespaces. The runtime import must be the module singleton from
`../../../api/capabilities`, not `app.capabilities`: `app.capabilities` is an
`Object.defineProperty(this, key, { get: () => this._serviceValues[key] })` getter in
`src/renderer/api/app.ts`, and is `undefined` until `initServices()` populates the service map.
Registering against it at module load would register `undefined`.
- In `src/renderer/scripting/ai-vision/root.ts`, add a root-reachable `ROOT_MEMBERS` entry for
  `{ name: "capabilities", kind: "property", node: true, summary: "…" }`, matching the existing
  `recent` entry, and add the corresponding root getter `get capabilities() {
  return this.app.capabilities; }`, matching `get recent() { return this.app.recent; }`.
  The descriptor registration plus these two root steps are all required: without them,
  `mcp__persephone__call` can list the namespace descriptor but a path of `capabilities` does not
  resolve and EPIC-108's MCP-observable criteria fail.
- With the namespace registration, root member, and root getter in place, `app.capabilities.list()`
  and `handlers("...")` become observable through MCP without opening a board page.

### 9. Keep declaration copies and scope boundaries explicit

The following source declarations change and must be copied byte-for-byte to their existing flat
asset counterparts:

- `src/renderer/api/types/capabilities.d.ts` → `assets/editor-types/capabilities.d.ts`
- `src/renderer/api/types/board-editor.d.ts` → `assets/editor-types/board-editor.d.ts`
- `src/renderer/api/types/board-info-editor.d.ts` → `assets/editor-types/board-info-editor.d.ts`

All three are already listed in `assets/editor-types/_imports.txt`; verify the entries remain
present and do not add duplicates. Do not add unit tests or a test harness. After implementation,
use the project's existing typecheck, lint, production build, and live MCP/app observations; this
planning task itself makes no implementation changes.

## Concerns / Open Questions

- **Import-cycle-safe built-in seeding is resolved:** `register-editors.ts` imports
  `custom-editor-registry.ts` before its editor rows have finished registering. The capability
  index must therefore seed platform candidates lazily and idempotently, not from a module-top-level
  snapshot. This preserves both built-ins and board registration when the custom registry imports
  capability registration functions.
- **Built-in `content.view` has an existing representation discriminator:** the wire contract does
  not add a `representation` field. Keep the current private representation-keyed callable map for
  the typed built-in overloads, while the public open-id index carries the D4 registration metadata.
  Do not invent a new wire field or rewrite the current callers.
- **Empty capability IDs must remain reportable:** the provider normalizer drops blank types, but
  EPIC-108's acceptance criterion explicitly requires a readable empty-id refusal. The capability
  normalizer retains the empty-id declaration record; registry validation owns the refusal.
- **Trust disclosure and protected ownership:** `src/renderer/api/boards.ts` must remain untouched.
  The dialog helper's manifest backfill is the resolved compatibility path for its existing caller;
  the two other manifest-aware trust paths pass the normalized IDs directly.
- **Manifest edits are not live watchers:** as with the existing custom-editor refresh, a manifest
  edit alone is not a registration refresh trigger. Verification must use a trust/untrust refresh,
  application restart, or the existing refresh path; adding a filesystem watcher is out of scope.
- **`payloadSchema` is storage/disclosure only:** EPIC-108's deferred validation boundary remains
  in force. This task must never reject a declaration because its schema is unsupported or
  malformed, and must not attempt JSON-schema validation.
- **No invocation lifecycle leakage:** typed rejection codes, request IDs, deadlines, cancellation,
  chain/depth state, board-frame transport, and actual board invocation belong to US-1480/US-1481.
  This task only supplies the index, resolver/order, registration lifecycle, and observation
  surfaces those tasks consume.
- **No main-owned registry:** EPIC-108 D1 keeps the derived index renderer-local. Do not add main
  process state, cross-window routing, `registryChanged(kind)`, or a renderer cache protocol.

## Acceptance Criteria

- [ ] `BoardManifest` has `capabilities?: BoardCapabilityDeclaration[]` with exactly the six
      manifest fields required by US-1479, and `normalizeCapabilities()` preserves reportable
      malformed declarations while leaving id/version validation to the registry.
- [ ] The documented Permissions vocabulary still includes `capabilities`, unknown permission
      values remain forward-compatible, and the capability array—not the permission string—is the
      functional registration trigger.
- [ ] `src/ipc/capability-bus-channels.ts` exports exactly the four constants, the closed D5
      `CapabilityErrorCode`, `CapabilityOrigin`, `CapabilityDeclaration`, `CapabilityRegistration`,
      `IntentRequest`, `IntentSettlement`, and `CapabilityTransport` pinned by EPIC-108, with no
      implementation imports.
- [ ] The renderer index accepts arbitrary string ids, stores separate bare id/version fields,
      exposes origin/priority/version/boardRoot plus declaration metadata, and provides read-only
      `list()` and `handlers(id, filter?)` snapshots.
- [ ] D4 ordering is observable and exact: default priority 50; strict numeric priority; platform
      wins a tie; trusted-list/registration order wins board ties; exact version pinning; accepts
      filtering; all losing candidates remain listed; built-ins cannot be removed by a board.
- [ ] The existing four typed `invoke()` overloads and all current internal callers still compile;
      the general string/payload/options signature is additive. No board invocation is implemented.
- [ ] `MermaidEditor.convertToExcalidraw()` keeps an explicit `DiagramEditResult` variable type
      instead of deriving `Awaited<ReturnType<typeof app.capabilities.invoke>>`; adding the general
      overload must not turn its `status`, `message`, or `imageOnly` reads into `unknown` errors.
- [ ] A trusted board with no custom-editor association can register capabilities, and each valid
      declaration registers independently. Empty id, id containing `@`, id containing whitespace,
      and non-integer version refusals use `CustomEditorRegistrationIssue` with `kind: "capability"`;
      one refusal does not block the board's valid declarations.
- [ ] `refresh()` releases capabilities over the complete board-origin set, exactly like
      `unregisterBoardProviders(roots)`, so untrust/removal cannot leave stale registrations. The
      trusted roots list is never used as the release filter, and platform entries survive rebuilds.
- [ ] Board Info shows normalized capability declarations beside Content providers and readable
      capability registration warnings; its model, facade, source declaration, and asset copy agree.
- [ ] The Trust Board dialog and its AiVision mirror show the declared capability IDs on all trust
      paths without changing trust semantics; `src/renderer/api/boards.ts` remains unchanged.
- [ ] `page.editor.getManifest()` preserves the capability axis, and the three changed declaration
      files match their `assets/editor-types/` copies with existing `_imports.txt` entries intact.
- [ ] The new AiVision `capabilities` namespace is registered and exposes only read-only `list()`
      and `handlers(id, filter?)`, is present in `ROOT_MEMBERS`, and is returned by the root
      `get capabilities() { return this.app.capabilities; }` getter, making discovery reachable
      through MCP without activation. The D5 `busy` code is reserved for platform capacity refusal,
      distinct from handler-originated `rejected`.
- [ ] No changes are made to `src/board-shim.ts`, `src/ipc/board-bridge-channels.ts`,
      `src/renderer/editors/board/BoardWebview.ts`, `src/renderer/api/boards.ts`, or any
      `src/renderer/api/capability-bus.ts`; no unit tests or harnesses are added.
- [ ] After implementation, `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass, and
      the Wave 1 live observations verify discovery, ordering, refusal isolation, teardown, and
      MCP visibility without requiring an invocation transport.

## Files that need NO changes

- `src/board-shim.ts` — board-side bridge/shim is US-1481-owned.
- `src/ipc/board-bridge-channels.ts` — `BoardPortInitMsg.intent` and bridge message work is
  US-1481-owned.
- `src/renderer/editors/board/BoardWebview.ts` — frame transport and lifecycle are US-1481-owned.
- `src/renderer/api/boards.ts` — explicitly protected parallel-work file; dialog compatibility is
  handled in `TrustBoardDialog.ts`.
- `src/renderer/api/capability-bus.ts` — US-1480's lifecycle implementation; this task provides
  only its wire interface and registry seam.
- `src/renderer/editors/base/editorRegistry.ts` and `src/renderer/editors/register-editors.ts` —
  the built-in capability declaration table already exists and is the seed source; no second table
  or editor-row change is required.
- `src/renderer/api/board-trust.ts`, trust storage, and service-permission helpers — trust
  persistence and service lifecycle are outside this axis.
- Any test file or test harness — the project uses live app/MCP observations for this epic.
- `doc/active-work.md` and `doc/epics/EPIC-108.md` — both already link/list US-1479 correctly;
  neither needs a duplicate entry or wording change.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/editors/board/board-manifest.ts` | Add `BoardCapabilityDeclaration`, `BoardManifest.capabilities`, and the report-preserving normalizer; retain the documented permission vocabulary. |
| `src/ipc/capability-bus-channels.ts` | New dependency-free Wave 2 wire contract with the exact EPIC-108 exports. |
| `src/renderer/api/capabilities.ts` | Add the renderer-local candidate index, D4 ordering/filtering, board registration/release seam, lazy built-in seed, and additive public discovery methods while preserving typed built-in invocation. |
| `src/renderer/api/types/capabilities.d.ts` | Widen ids and declare read-only registration metadata, filter, list/handlers, and the additive general invoke signature. |
| `assets/editor-types/capabilities.d.ts` | Hand-maintained exact copy of the changed capability declaration file. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Register trusted board declarations during `refresh()`, release all board-origin entries, and retain per-declaration capability issues. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Carry normalized capability declarations in `BoardPropsInfo` and pass IDs through the manifest-aware trust path. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Render capability declarations and label capability refusal warnings. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Copy capability declarations into the public Board Info properties snapshot. |
| `src/renderer/api/types/board-info-editor.d.ts` | Declare Board Info capability declaration and `kind: "capability"` types. |
| `assets/editor-types/board-info-editor.d.ts` | Hand-maintained exact copy of the changed Board Info declaration file. |
| `src/renderer/ui/dialogs/TrustBoardDialog.ts` | Add capability-ID disclosure state and manifest fallback for the protected legacy caller. |
| `src/renderer/ui/dialogs/TrustBoardDialogView.ts` | Render the Capabilities disclosure row. |
| `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` | Mirror the capability-ID disclosure getter/member. |
| `src/renderer/editors/board/BoardEditorView.ts` | Pass normalized capability IDs through the existing direct-board trust flow. |
| `src/renderer/api/types/board-editor.d.ts` | Add capability declarations to the public manifest snapshot. |
| `assets/editor-types/board-editor.d.ts` | Hand-maintained exact copy of the changed board manifest declaration file. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Copy capability declarations through `page.editor.getManifest()`. |
| `src/renderer/scripting/ai-vision/namespaces/capabilities.ts` | New read-only AiVision descriptor for `list()` and `handlers()`. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | Register the new capabilities descriptor against the runtime service. |
| `src/renderer/scripting/ai-vision/root.ts` | Add the root `capabilities` member and getter so the namespace is reachable by MCP paths. |
| `src/renderer/editors/mermaid/MermaidEditor.ts` | Import `DiagramEditResult` and replace the overloaded `ReturnType` variable with the explicit result type. |
| `assets/editor-types/_imports.txt` | No content change; verify existing entries for all three changed declaration copies remain unique. |
