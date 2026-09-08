# US-1390 — Board `.app` AiVision remote tree

**Status:** Planned · **Epic:** [EPIC-097](../../epics/EPIC-097.md) · **Roadmap:** steps 2–4

## Goal

Expose a trusted board's own AiVision tree as `pages[i].editor.app`, using the board iframe as a
remote execution endpoint and the host renderer as the resolver/proxy owner. Add the bridge
protocol, registration/lifecycle handling, and the four-level timeout policy. This task is
investigation and planning only; the dashboard entry already exists and no product source is to be
implemented here.

## Background

US-1389 is already present in the working tree: `ai-vision@^1.0.0` is installed, the old
`src/shared/ai-vision/` copy is gone, and Persephone importers use `ai-vision` / `ai-vision/dom`.
The board shim is still version `1.2.0` (`src/board-shim.ts:562-566`), and the existing
board-frame channel is currently board-initiated only: `board:var`/`var:result` and
`board:filePath`/`filePath:result` (`src/ipc/board-bridge-channels.ts:208-300`).

The roadmap's remote design is host-side resolution, a shape-only registration, trust at the
host boundary, host-enforced timeouts, and schema-major versioning. The board page and its shim
remain cross-origin and do not receive renderer or main-process objects.

### Library contract verified in `node_modules/ai-vision`

The installed declarations are the source of truth for the protocol. The exact shape declarations
are from `node_modules/ai-vision/dist/core/remote-types.d.ts`:

```ts
export interface IAiVisionShape {
    readonly schemaVersion: number;
    readonly root: IAiNodeShape;
}
export interface IAiNodeShape {
    readonly kind: string;
    readonly summary: string;
    readonly overview?: string;
    readonly help?: string;
    readonly members: readonly IAiMemberShape[];
    readonly elements?: readonly IAiElementDeclaration[];
    readonly indexable?: boolean;
    readonly hasChildren?: boolean;
    readonly item?: IAiNodeShape;
}
export interface IAiMemberShape extends Pick<IAiMember, "name" | "kind" | "summary" | "signature" | "caution" | "writable"> {
    readonly indexable?: boolean;
    readonly timeoutMs?: number;
    readonly node?: IAiNodeShape;
    readonly item?: IAiNodeShape;
}
```

`IAiElementDeclaration` (from `dist/core/types.d.ts`) is:

```ts
export interface IAiElementDeclaration {
    readonly name: string;
    readonly purpose: string;
    readonly where?: string;
    readonly selector?: string;
    readonly reveal?: IAiElementReveal;
}
export interface IAiElementReveal {
    readonly selector: string;
    readonly display: string;
}
```

The shape therefore carries the serialized
member fields `name`, `kind`, `summary`, optional `signature`, `caution`, `writable`, plus
`indexable`, `timeoutMs`, nested `node`, and indexed `item`; nodes carry the optional `elements`
declarations and node-level `indexable`, `hasChildren`, and `item` fields. It carries structure,
not live values or functions.

The exact request/action/response declarations from `dist/core/remote-types.d.ts` are:

```ts
export type AiRemoteAction = "ai:get" | "ai:set" | "ai:invoke" | "ai:children" | "ai:elements" | "ai:highlight";
export interface IAiRemoteRequest {
    readonly action: AiRemoteAction;
    readonly path: string;
    readonly args?: readonly unknown[];
    readonly value?: unknown;
    readonly maxLength?: number;
    readonly timeoutMs?: number;
    readonly view?: string;
    readonly name?: string;
    readonly message?: string;
}
export type IAiRemoteResponse = {
    readonly ok: true;
    readonly result?: unknown;
    readonly truncated?: boolean;
    readonly totalLength?: number;
    readonly shown?: number;
    readonly total?: number;
} | {
    readonly ok: false;
    readonly error: string;
};
```

The exact remote entry-point declarations from `dist/remote/expose.d.ts` and
`dist/remote/index.d.ts` are:

```ts
export interface IExposeOptions {
    readonly publish?: boolean;
    readonly onWarning?: (message: string) => void;
}
export interface IAiVisionRemote {
    readonly schemaVersion: number;
    describe(): IAiVisionShape;
    handle(request: IAiRemoteRequest): Promise<IAiRemoteResponse>;
    refresh(): void;
    dispose(): void;
}
export declare function expose(root: object, options?: IExposeOptions): IAiVisionRemote;
```

The remote barrel exports `expose`, `IAiVisionRemote`, `IExposeOptions`, the remote request,
response, shape types, and `AI_VISION_SCHEMA_VERSION`. The exact proxy declaration from
`dist/core/remote-proxy.d.ts` is:

```ts
export interface IRemoteProxyOptions {
    readonly restricted?: () => string | undefined;
    readonly originNote?: string;
    readonly onWarning?: (message: string) => void;
    readonly onError?: (error: unknown) => void;
}
type RemoteSender = (request: IAiRemoteRequest) => Promise<IAiRemoteResponse>;
export declare function createRemoteProxy(shape: IAiVisionShape, send: RemoteSender, options?: IRemoteProxyOptions): IAiVisible;
```

`createRemoteProxy` returns `IAiVisible` (an object with `aiVision`), not a raw descriptor. Its
proxy sends the six actions above, follows declared nested `node`/indexed `item` shapes, and carries
a member's declared `timeoutMs` on its leaf request. Writable setters are fire-and-forget and
report failures through `onError`; `onWarning` reports sanitized/invalid shape metadata.

The exact timeout declaration from `dist/core/timeout.d.ts` is:

```ts
/** Return the first timeout value that is defined, from most to least specific. */
export declare function resolveTimeoutMs(perCall: number | undefined, declared: number | undefined, runtime: number | undefined, fallback: number): number;
```

The package implementation was also checked, not inferred. `dist/remote/expose.js:2-15` publishes
`window.__aiVision` by default, catches remote action errors into `{ ok: false, error }`, and
`refresh()` re-describes the root; `publish: false` is therefore required for the Persephone
shim, which owns `persephone.aiVision`. `dist/core/remote-proxy.js:2-143` confirms that the proxy
forwards member declaration timeouts and uses `restricted`, `onWarning`, and `onError` as declared.

Finally, the shipped `dist/core/resolver.js:88-89` checks `descriptor.provide(name)` before
`target[name]`, so a `provide`-backed `app` node member resolves. The shipped
`dist/core/help-search.js:27-35` descends declared node members, `:53-87` collects member,
element, and `$help` hits, and `:102-109` uses the same provider while following a member or
call. Thus the planned `provide`-backed `.app` is discoverable by both `$help` and `helpSearch`;
this is the EPIC-096 fix, and it is present in the installed build.

One important package fact is retained in the plan: the shipped `ICallRequest` in
`dist/core/resolver.d.ts` has `path`, `args`, `value`, `hints`, and `maxLength`, but no
`timeoutMs`. The host call option must therefore be carried as a Persephone request-context
extension until the library adds it to `ICallRequest`; the read-only package is not modified.

## Implementation Plan

### 1. Add the opposite-direction wire protocol

Update `src/ipc/board-bridge-channels.ts`, preserving its dependency-free rule. Add a type-only
import from `ai-vision`:

```ts
import type { IAiRemoteRequest, IAiRemoteResponse, IAiVisionShape } from "ai-vision";
```

This is erased by TypeScript, so it adds no runtime dependency to either the shim IIFE or the
`src/main/board-bridge.ts` build. Verify that fact with the shim IIFE build and the main build.

The current `BoardToHostMsg` is an interface whose `__persephone` property is a union, rather than
a TypeScript discriminated-union alias. Add only these exact new discriminants to that existing
interface:

```ts
// Before: the final two discriminants are "board:var" | "board:filePath";
__persephone: ... | "board:aiVision" | "board:aiResult";
```

Do not add optional `schemaVersion`, `shape`, or `response` slots to `BoardToHostMsg`: that would
be a second, drift-prone representation. The named interfaces below are authoritative for those
wire payloads. `BoardWebview.handleMessage` will cast its received value to
`BoardToHostMsg | BoardAiVisionRegistrationMsg | BoardAiVisionResultMsg`; the switch will narrow
the two AiVision cases to the named interfaces. This is the only widening needed for its current
data cast, and preserves the existing common fields for the older messages.

Add named interfaces so both directions have exact compile-time wire shapes:

```ts
export interface BoardAiVisionRegistrationMsg {
    __persephone: "board:aiVision";
    schemaVersion: number;
    shape: IAiVisionShape;
}

/** Host renderer → board iframe; the new opposite direction on this channel. */
export interface BoardAiVisionRequestMsg {
    __persephone: "ai:request";
    reqId: number;
    request: IAiRemoteRequest;
}

export interface BoardAiVisionResultMsg {
    __persephone: "board:aiResult";
    reqId: number;
    response: IAiRemoteResponse;
}
```

`BoardAiVisionRegistrationMsg` is fire-and-forget and has no request id. A host leaf request gets a
monotonic renderer-owned `reqId`; `BoardAiVisionRequestMsg.reqId` is echoed unchanged by
`BoardAiVisionResultMsg`. The host keeps a pending map, removes the entry on the first matching
reply, and ignores an unknown/late id. `IAiRemoteRequest.view` remains reserved on the wire, but
US-1390 does not route it.

### 2. Extend the board shim and measure the IIFE

In `src/board-shim.ts`, import the runtime `expose` from `ai-vision/remote` and type-only
`IAiRemoteRequest`/`IAiVisionRemote` from `ai-vision`. Add a main-frame board-owned surface beside
the existing `call` surface:

```ts
// Before (`src/board-shim.ts:562-566`)
version: "1.2.0",
// ... later:
call,

// After
version: "1.3.0",
aiVision: { schemaVersion: AI_VISION_SCHEMA_VERSION, expose: exposeAiVision },
call,
```

`exposeAiVision(root)` will:

1. Dispose the previous stored remote, increment the shim's remote generation, and call
   `expose(root, { publish: false, onWarning })`. `publish: false` prevents the package's
   `window.__aiVision` publication; the returned remote is stored by the shim.
2. Post `BoardAiVisionRegistrationMsg` to `window.parent` with the returned `schemaVersion` and
   `remote.describe()` shape. Only the `viewRole === "main"` frame registers; secondary frames
   still have the API surface but do not create a host `.app` registration.
3. Return an `IAiVisionRemote` wrapper whose `handle` and `dispose` delegate to that remote and
   whose `refresh()` calls the package remote's `refresh()` and posts a fresh registration shape.
   This makes the declared library `refresh()` useful without adding an undocumented separate
   shim API. A second `expose()` disposes/replaces the prior remote and publishes the replacement
   shape; replies from an old-generation in-flight handle are suppressed.

`BoardWebview.createIframe` installs the host `message` listener at
`src/renderer/editors/board/BoardWebview.ts:147`, before the iframe is appended at `:149`.
Appending is what starts the frame load, so a board that calls `expose()` during parse cannot lose
its registration to a missing listener. No registration re-post is needed on the port handshake;
`expose()` and the wrapped `refresh()` are the registration posts.

Add an `onHostMessage` listener with the exact existing trust gate at
`src/board-shim.ts:368-376` (`event.source === window.parent` plus the strict HTTP(S) origin
check). It accepts `BoardAiVisionRequestMsg`, calls the currently stored remote's
`handle(request)`, and posts `BoardAiVisionResultMsg`. If no root is registered, it returns an
`IAiRemoteResponse` error rather than hanging. It must capture the iframe/remote generation before
the async call and post only while that generation is current.

The current shim timer (`src/board-shim.ts:268-296`) is for board-originated
`persephone.call()`, not the new host→board request. Apply EPIC-097 decision 6: replace its
30-second value with a clearly named generous dead-port guard of `2_147_000_000` ms (just under
the browser timer maximum). The invariant beside that constant is: **the shim guard must exceed
any host-side limit**; the public level-3 setter is bounded to `3_600_000` ms below. It is not a
second four-level policy; the host timeout rejects its own wait while the remote may continue, and
the guard only handles a dead bridge. Add optional `timeoutMs` validation/forwarding to the
existing board `call` request so the board-side caller can select level 1 where that API is used.

At the existing port handshake (`src/board-shim.ts:351-361`), a genuinely new port first closes
the old port, rejects every pending `call()` entry with a bridge-replaced error, clears each entry's
timer, and then becomes the active port. A duplicate delivery of the same port remains ignored.
This prevents the generous guard from pinning a dead call's closures when the bridge is recreated.

Measured production shim sizes (unminified `format: "iife"`, `npm run build-prod`, filesystem byte
length):

| Production-served inline shim | Uncompressed bytes | Gzip bytes |
|---|---:|---:|
| Before, `.vite/build/board-shim.js` wrapped as `<script id="persephone-shim">` | 46,629 | 14,468 |
| After implementation, `.vite/build/board-shim.js` wrapped the same way | 77,967 | 22,525 |

These are the actual served inline fragment produced by
`src/main/board-protocol-service.ts:118-145` (the built source plus its `<script>` wrapper and
closing-tag escaping), not merely the source file's filesystem size. The planning overlay used an
in-memory source build; the implementation values above were measured from the committed build
output after `npm run build-prod`.
For reference, the underlying unwrapped build is 46,591 → 77,929 bytes; the served figures above
are the ones that affect each board document.
The gzip increase is 8,057 bytes, so the roadmap's “small” cost assertion is not supported for
each served board document and must be corrected in the epic/roadmap follow-up.

### 3. Store the registered shape against the live frame generation

In `src/renderer/editors/board/BoardEditorModel.ts`, add transient (non-`BoardEditorState`)
registration state next to `frames`/`loadedTabs` (`:130-145`). It must contain the accepted
`IAiVisionShape`, the main iframe identity, a generation/token, the request transport callback,
and the warning sink. Expose narrow model methods for `BoardWebview` and the facade, rather than
letting scripting code reach the DOM frame directly.

In `BoardWebview` (`src/renderer/editors/board/BoardWebview.ts`):

- Extend the existing authenticated `handleMessage` switch (`:270-340`) with
  `board:aiVision` and `board:aiResult`. Registration is accepted only for `isMain`, the current
  frame, a live model, schema major `1`, a minimally valid shape, and a trusted `boardRoot`.
  Invalid-version/shape registrations are ignored and logged through `appendLog`. Every accepted
  registration replaces the stored shape and increments the model's registration token, including
  a `refresh()` re-post on the same frame generation; a second `expose()` therefore replaces both
  the remote shape and the cached host proxy.
- Add a host→board `requestAiVision(request)` transport. Allocate a request id, capture
  `generation`, `iframe`, and `frame.contentWindow`, post `BoardAiVisionRequestMsg` to the exact
  `board://${host}` target, and resolve only a matching `board:aiResult` from the authenticated
  current frame. `appendLog` at `:390-395` is the warning sink used by the facade's `onWarning`.
- Follow the existing `resolveFilePath`/`resolveVariable` staleness checks
  (`:343-384`) exactly: after an await, require `live`, unchanged generation, the same iframe,
  and a non-null current `contentWindow`. On `onDispose`, `clearIframe`, or replacement, reject
  and clear all pending AiVision promises with a frame-replaced error; never deliver the result to
  a new frame. Late results are ignored by the request-id map.

In `BoardEditorModel`:

- `setIframe` (`:147-149`) establishes the frame identity; `clearIframe` (`:155-161`) clears the
  registration only when the matching frame is removed.
- `reloadBoard`/`reloadAndWait` (`:547-557`) clear the registration before changing
  `reloadToken`; the next `handleLoad` must register a new shape for the new generation.
- `dispose` (`:579-599`) clears the shape, warning/transport callbacks, pending waiters, and
  frame references.
- Subscribe to `boardTrust.subscribePaths` (`src/renderer/api/board-trust.ts:87-94`) for the
  model's board root and clear the registration immediately when `isTrusted` (`:70-75`) becomes
  false. Registration and transport methods repeat the synchronous trust check, so an untrust
  event between subscription delivery and a request cannot leak a leaf operation.

The existing `BoardEditorView` already binds model identity/reload state and trust changes at
`src/renderer/editors/board/BoardEditorView.ts:157-165`; it need not own the shape and should not
be made the request router.

### 4. Add `.app` to the board facade only when a shape exists

Define one renderer-only context in `src/renderer/scripting/ai-vision/root.ts`:

```ts
export interface IAiCallContext {
    readonly timeoutMs?: number;
}
```

Add `callContext?: IAiCallContext` to `AiRootOptions`. `resolveAiCall` creates this one object per
call from the request's Persephone timeout extension, then constructs `AiRoot` with it; `aiCall`
does not create another object. The separate `AppWrapper.call` entry at
`src/renderer/scripting/api-wrapper/AppWrapper.ts:152` creates the same single context shape for
its call and puts it in `AiRootOptions`. `AiRoot.pages` obtains a context-bearing view of the
existing collection, and `PageCollectionWrapper`, `PageWrapper`, and the board facade pass the
same object reference through. No scalar `timeoutMs` is threaded through those classes.

Change the shared factory type in `src/renderer/scripting/api-wrapper/PageWrapper.ts:79-83` to
exactly this shape:

```ts
type EditorFacadeFactory =
    (editor: EditorModel, id: string, name: string, callContext?: IAiCallContext) => EditorFacade;
```

Every non-board factory keeps its current three-argument implementation and ignores the optional
fourth argument. `PageWrapper.editor` passes the one context as that fourth argument, and only
`BOARD_FACADE_FACTORY` passes it to `BoardEditorFacade`. This makes adding a future per-call field
an edit to `IAiCallContext`, not six scalar signature changes or a change to ~30 factories.

In `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:104-142`, import
`createRemoteProxy`, `resolveTimeoutMs`, and the remote request/response types. Keep `BOARD_MEMBERS`
as the local board API and add one conditional member:

```ts
// Before
members: [...BROWSER_AUTOMATION_MEMBERS, ...BOARD_AUTOMATION_TAB_MEMBERS, ...BOARD_MEMBERS, ...elements.members],
provide: elements.provide,

// After
const app = registration ? createRemoteProxy(registration.shape, send, {
    restricted: () => this.restricted(),
    onWarning: (message) => this.editor.appendAiVisionWarning(message),
    onError: (error) => this.editor.appendAiVisionWarning(errMessage(error)),
}) : undefined;
members: [...BROWSER_AUTOMATION_MEMBERS, ...BOARD_AUTOMATION_TAB_MEMBERS, ...BOARD_MEMBERS,
    ...(app ? [APP_MEMBER] : []), ...elements.members],
provide: (name) => name === "app" && app ? { value: app } : elements.provide(name),
```

The actual implementation will cache the proxy by the model registration token so repeated
descriptor reads do not create competing transports. `APP_MEMBER` is a property node with a
summary explaining that it is the trusted board-owned remote tree. The `.app` member is absent
from `members` and `provide` when no shape is registered, including untrusted, stale, secondary,
not-yet-loaded, and frame-replaced states.

`send` calls the model/Webview transport and applies the four-level policy below. The wire `path`
remains the proxy-relative path expected by `IAiVisionRemote`. For timeout diagnostics, use the
page id already available as `this.editor.page?.id` (`BoardEditorFacade.ts:111-114`): emit
`pages["<pageId>"].editor.app.<path>` (with `JSON.stringify(pageId)` for the bracket value),
using `app.<path>` only when the page id is unavailable. Use `<root>` for an empty proxy path.
This is the path the agent typed, so a timeout from
`pages[3].editor.app.rebuildIndex()` reports the concrete page-id form that can be retried.
The proxy's `restricted` callback is the facade's existing `restricted()` (`:321-324`), so it
gates every nested leaf/action. The proxy's `onWarning` and `onError` both reach
`BoardWebview.appendLog` through the model warning sink; `appendLog` writes the board's `ui.log`
at `:390-395`.

When an accepted registration (including a refresh re-post) replaces the model shape, increment a
`registrationToken` and invalidate the cached proxy. The token, not the frame generation, is the
proxy-cache key: `refresh()` keeps the same frame generation but must still replace the cached
shape/proxy, while a second `expose()` also replaces it. A rejected registration does not change
the token.

Add exactly one line to `BOARD_HELP` (`:71-102`):

```text
When a trusted board registers an AiVision shape, app is its board-owned remote tree; use app.$help or helpSearch to discover it.
```

The installed resolver verification above is important to this composition: `provide("app")`
returns the proxy value, and the proxy's own descriptor/provider then resolves nested members.
The shipped `help-search.js` descends through that provider, so `$help` and `helpSearch` do not
stop at the facade boundary.

Dynamic children are part of this same action-agnostic transport. When the registered shape has
`hasChildren`, `createRemoteProxy` issues `ai:children` for the node; when that response authorizes
a child that is not in the static `members` list, EPIC-096's resolver fix falls back to `ai:get`
for the child value. `send` forwards the complete `IAiRemoteRequest` unchanged apart from the
host timeout field, so no separate dynamic-child protocol or routing is needed.

### 5. Thread the four timeout levels end to end

Use these exact precedence levels everywhere a host waits for a remote board leaf. Validate each
configured value as a finite positive integer before calling the library helper:

| Level | Value | Source/read point |
|---|---|---|
| 1 | Per-call `timeoutMs` | `src/main/mcp/tools/call-tools.ts` schema and `src/renderer/api/mcp/call-command.ts`; carry as a renderer call-context extension because `ICallRequest` has no such field. Also accept/forward it in board `persephone.call()` validation. |
| 2 | Remote-declared member `timeoutMs` | `IAiMemberShape.timeoutMs`, emitted by `expose` and received by `createRemoteProxy`; the proxy puts it on the leaf `IAiRemoteRequest`. |
| 3 | `boards.callTimeoutMs` | Renderer memory in `src/renderer/api/boards.ts`, exposed by `src/renderer/scripting/ai-vision/namespaces/boards.ts`; setter pushes the same value over the existing typed API IPC surface to main. |
| 4 | Built-in fallback `30_000` ms | The host send helper's fallback, passed to `resolveTimeoutMs`. |

Because `resolveTimeoutMs` returns only a number, do not derive the diagnostic level at a second
call site. Add one application-local helper (shared by renderer and main) in
`src/shared/ai-vision-timeout.ts`:

```ts
export function resolveBoardCallTimeout(
    perCall: number | undefined,
    declared: number | undefined,
    runtime: number | undefined,
): { ms: number; level: 1 | 2 | 3 | 4; label: string } {
    const level = perCall !== undefined ? 1
        : declared !== undefined ? 2
        : runtime !== undefined ? 3
        : 4;
    const ms = resolveTimeoutMs(perCall, declared, runtime, 30_000);
    return { ms, level, label: ["", "per-call timeoutMs", "remote-declared timeoutMs",
        "boards.callTimeoutMs", "built-in 30-second fallback"][level] };
}
```

The implementation must keep the level selection and the `resolveTimeoutMs` argument order in
this one helper. Every host wait uses its returned `ms`, `level`, and `label`; no facade or main
error path recomputes precedence independently. The facade call is therefore:

```ts
const { ms, level, label } = resolveBoardCallTimeout(perCallTimeoutMs, request.timeoutMs, runtimeTimeoutMs);
await withTimeout(sendToBoard(request), ms, () =>
    new Error(`AiVision request timed out at level ${level} (${label}) for path ${agentPath}.`));
```

It wraps only the host wait, removes the pending id on timeout, and leaves the board remote
operation running as required by the library README. The exact timeout error text is:

```text
AiVision request timed out at level N (LEVEL_NAME) for path "AGENT_TYPED_PATH".
```

where `N` is `1`–`4`, `LEVEL_NAME` is respectively `per-call timeoutMs`,
`remote-declared timeoutMs`, `boards.callTimeoutMs`, or `built-in 30-second fallback`, and `PATH`
is the agent-typed path: `pages["<pageId>"].editor.app.<path>` when
`this.editor.page?.id` is available, or `app.<path>` otherwise; `<path>` is `<root>` for an empty
proxy path. `agentPath` is formatted before the wait, so the timeout error names both the applied
level and the retryable complete board-facade path.

Thread level 1 through every declaration/validation point:

- Add `timeoutMs` to the `call` tool schema and description in
  `src/main/mcp/tools/call-tools.ts:130-135`, preserve it in the forwarded params at `:148-159`,
  and parse it in `src/renderer/api/mcp/call-command.ts:9-18`.
- Add it to `IAppCallOptions` (`src/renderer/api/types/app.d.ts:191-199`) and to
  `AppWrapper.call` (`src/renderer/scripting/api-wrapper/AppWrapper.ts:142-154`), then pass the
  one `IAiCallContext` object described in §4 through `AiRootOptions` (`root.ts:23-28`),
  `PageCollectionWrapper` (`:100-106,148-175`), `PageWrapper` (`:160-165,200-210`), and its
  optional fourth-argument board facade factory (`PageWrapper.ts:79-83`). This ships
  `app.call()` support as well as MCP `call` support; all three entry points (`call` tool,
  `app.call()`, and `persephone.call()`) use the same context and timeout helper.
- Add `timeoutMs` to `BoardCallRequest` in `src/ipc/board-bridge-channels.ts:132-138` and
  validate/forward it in `src/renderer/api/mcp/board-call-command.ts:17-31` for the existing
  board-originated `persephone.call()` route.

Expose `boards.callTimeoutMs` as a writable `IAiMember` in
`src/renderer/scripting/ai-vision/namespaces/boards.ts:9-25` and in `src/renderer/api/types/boards.d.ts`.
Implement the renderer-memory getter/setter in `src/renderer/api/boards.ts` (the current object
literal begins at `:229`); the setter rejects anything that is not a finite integer in the inclusive
range `1_000 … 3_600_000` ms, updates valid values immediately, and sends the value through
`api.setBoardCallTimeout`. The same range validation is repeated at the IPC/main boundary.

That API IPC path is a new typed endpoint on the existing API surface, not a new board-frame
protocol: add `Endpoint.setBoardCallTimeout` to `src/ipc/api-types.ts:99-112`, add its
`Api` signature beside the board endpoints at `:234-255`, add the `ipc/renderer/api.ts` wrapper
beside `setBoardBusy` (`:409-417`), and bind it in `src/ipc/main/board-handlers.ts:7-75` to
`setBoardCallTimeout` exported by `src/main/board-bridge.ts`.

In `src/main/board-bridge.ts:139-142,251-258`, replace the constant-only timeout with a validated
module variable. The `2_147_000_000` ms shim guard is greater than the maximum
`3_600_000` ms host-side limit; preserve the invariant that **the shim guard must exceed any
host-side limit**. `runBoardCall` reads the level-3 variable for every new inbound board call and uses the shared
`resolveBoardCallTimeout(perCallTimeoutMs, undefined, boardCallTimeoutMs)`, so main enforces the
same level-3 value even though the renderer memory is the public setting. A stale response is
discarded by the existing `boardPorts.get(boardId) !== entry` check (`:259,266`).

### 6. Enforce trust at registration and every leaf

Trust is not inferred from a board message. The host registration branch checks
`boardTrust.isTrusted(boardRoot)` and the current model/frame before storing a shape; an untrusted
registration is ignored and logged. `BoardEditorModel` clears an already-stored shape when the
trust subscription sees an untrust, and `BoardWebview.requestAiVision` repeats the check before
every post.

The facade keeps the existing `restricted()` text exactly as implemented at
`BoardEditorFacade.ts:321-324` and passes it to `createRemoteProxy`. The resolver therefore allows
the board node to be explained/listed but rejects every descendant read, write, invoke, children,
elements, or highlight request while untrusted. The agent sees no `.app` member after the shape is
cleared; a previously obtained descriptor receives the existing restricted message rather than
executing. Registration, request, and result messages also remain behind the existing
source/origin gates on both sides (`BoardWebview.ts:270-282` and `board-shim.ts:368-376`).

### 7. Versioning and explicit non-goals

Accept schema major `1` only. The package README confirms additive fields and ignored unknown
fields within a major; reject/log another major with no shape registration. The shim version bump
is exactly `"1.3.0"`; this is independent of npm package semver. The wire retains `view?: string`
for the future remote contract, but US-1390 does not route `elements` or `highlight` to a
secondary/in-frame view.

Out of scope:

- US-1391: in-frame `elements`/`highlight` `view` routing.
- US-1392: browser-page remote tree.
- US-1393: guides and user-facing guide updates.
- Package changes in `C:\projects\ai-vision\src` or `node_modules/ai-vision`.
- Unit tests or test harnesses for this planning task.

## Concerns

- The package's public `ICallRequest` lacks `timeoutMs`, while the remote wire type has it. The
  renderer-only call-context extension is deliberate and must not be accidentally typed as a
  package `ICallRequest` until the package contract changes.
- A shape is a snapshot. The shim's wrapped `refresh()` re-registers the shape, and a second
  `expose()` replaces it; the host must never merge shapes from different frame generations.
- The board shim's dead-port guard is intentionally independent of the host four-level timer. The
  implementation must not reintroduce a 30-second shim rejection that defeats a larger selected
  timeout.
- Bundling the remote implementation adds 7,893 gzip bytes to each served board shim fragment
  (14,468 → 22,361 bytes). That is more than a few kB, so EPIC-097 decision 5's “small” cost
  assertion is corrected here rather than repeated; implementation review should decide whether
  this per-document cost needs a separate lazy/bundling follow-up.
- Registration is host-initiated in trust terms even though the board posts the registration:
  only the trusted host model can accept it, and the board cannot self-grant trust.
- The main endpoint setter is asynchronous behind a synchronous property setter. The renderer
  value is authoritative immediately; IPC failure must be logged/reported without silently
  changing the value or leaving main with an unvalidated value.

## Files that need NO changes

- `src/renderer/editors/board/BoardEditorView.ts` — it already observes reload identity and
  `boardTrust`; the model/Webview own the registration lifecycle.
- `src/renderer/editors/board/BoardSecondaryView.ts` — secondary frames do not register `.app` in
  US-1390; future view routing is US-1391.
- `src/main/board-protocol-service.ts` — it already inlines the built shim; the shim build output
  changes, not this serving mechanism.
- `src/main/cdp-service.ts` and `src/renderer/editors/browser/BrowserEditorModel.ts` — browser
  page support is US-1392 and CDP frame registration is already sufficient.
- `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` — no browser `.app` proxy in this
  task.
- `src/renderer/editors/board/board-api.d.ts` — the board author API gains no new declaration;
  `persephone.aiVision` is the shim runtime surface and its existing author declarations are out
  of scope here.
- `assets/guides/` and guide providers — US-1393.
- `src/shared/ai-vision/` and `C:\projects\ai-vision\src` — US-1389/package adoption is
  complete; neither is to be recreated or edited.
- QA/test harness directories — this task explicitly writes no tests.

## Acceptance Criteria

- `src/ipc/board-bridge-channels.ts` carries the exact type-only package contract and the new
  registration/request/result messages; `npm run typecheck` proves the IIFE and main builds erase
  the type-only import.
- A trusted main board frame can expose, register, refresh, and replace a shape; the host stores
  only the live frame-generation shape and `.app` is absent otherwise.
- `createRemoteProxy` resolves `.app` through `provide`, `$help`, and `helpSearch`; all six actions
  correlate by `reqId`, including `children()` and the dynamic-child `ai:get` fallback; stale/
  replaced-frame replies cannot resolve a current request.
- Trust blocks registration and every leaf; the existing `restricted()` message is visible to the
  agent and board warnings reach `ui.log` through `BoardWebview.appendLog`.
- All four timeout levels use `resolveTimeoutMs` with the exact level/path error text. The
  `boards.callTimeoutMs` value reaches `src/main/board-bridge.ts` through
  `Endpoint.setBoardCallTimeout`, and the shim timer is only the generous dead-port guard.
- The single `IAiCallContext` object is created once per call and passed by reference; the single
  `resolveBoardCallTimeout` helper supplies both the wait duration and reported level.
- Schema major `1`, additive unknown-field behavior, `persephone.version === "1.3.0"`, and the
  measured shim size are verified by the production build; the final implementation remeasures
  `.vite/build/board-shim.js` against the 46,591-byte baseline.
- `npm run build-prod`, `npm run typecheck`, and `npm run lint` pass after implementation. No
  product source is changed and no commit is created as part of this planning task.

## Files Changed summary

| File | Planned change |
|---|---|
| `src/ipc/board-bridge-channels.ts` | Add type-only remote types, registration/request/result wire contracts, and board-call `timeoutMs`. |
| `src/board-shim.ts` | Bundle `expose`, add `persephone.aiVision`, registration/handling/refresh, version `1.3.0`, and dead-port timer policy. |
| `src/renderer/editors/board/BoardWebview.ts` | Authenticate registration/results, correlate host requests, log warnings, and reject stale in-flight work. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Store transient shape/transport by frame generation and clear it on reload, teardown, and untrust. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Conditionally provide `.app`, proxy remote leaves, wire trust/warnings, and document it in `BOARD_HELP`. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Describe writable `boards.callTimeoutMs`. |
| `src/renderer/api/boards.ts` and `src/renderer/api/types/boards.d.ts` | Store/validate the renderer timeout setting and declare its API type. |
| `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/board-handlers.ts` | Add the typed `setBoardCallTimeout` API IPC endpoint. |
| `src/main/board-bridge.ts` | Store level 3 in a module variable and apply it to inbound board calls. |
| `src/main/mcp/tools/call-tools.ts`, `src/renderer/api/mcp/call-command.ts`, `src/renderer/api/mcp/board-call-command.ts` | Validate and forward per-call `timeoutMs` at every existing call boundary. |
| `src/shared/ai-vision-timeout.ts` | Centralize timeout precedence, applied-level labels, and the value used by every host wait. |
| `src/renderer/api/types/app.d.ts`, `src/renderer/scripting/api-wrapper/AppWrapper.ts` | Declare and carry `app.call()` timeout context. |
| `src/renderer/scripting/ai-vision/call.ts`, `root.ts`, `PageCollectionWrapper.ts`, `PageWrapper.ts` | Carry the renderer-only timeout context to board facade instances. |
