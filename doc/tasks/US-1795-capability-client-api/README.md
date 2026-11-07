# US-1795: Capability client API

## Goal

Implement the clients in [EPIC-140](../../epics/EPIC-140.md) using the [normative capability contract](../../../assets/guides/agents/capabilities.md). Keep existing board service channels and legacy bus execution compatible; do not implement agent call-tree nodes, board migrations or guide publication.

## Background

[US-1794](../US-1794-capability-registry/README.md) built `capabilityRouter.list`, `providers`, `resolve`, `invoke`, main's revisioned registry, service `handle`, and bound open dispatch. `src/renderer/api/capabilities.ts` still indexes `candidates` independently; `src/renderer/api/board-capability-transport.ts` owns page FIFO, request settlement, reuse and `discardPage`. `src/board-shim.ts` is built into an IIFE and injected into board pages, which have no preload. The service host is the standalone `assets/module-service-host.mjs` launched by the supervisor. The provider `claudetest.echo` already exists with `echo`, `slow` (1000 ms), `fail` (`agent: false`) and declared but unregistered `late`.

**Final decisions.** Board page and service `persephone.capabilities.list()` returns the async grant-filtered unified provider list without `appScripting`; page `capabilities.invoke` remains legacy and requires trust only, as today. Renderer `app.capabilities.list()` and `handlers(id)` remain synchronous legacy projections; `providers(id)` and `get(id, options?)` are asynchronous. `services.list/connect` remain unchanged and main-owned. Legacy bus execution remains in the renderer; only selection and discovery move to main. New proxies carry a registration key, not an opaque main binding; main authenticates the caller on every request and looks up and reauthorizes the registration. Version bump for both board clients is 1.50.0 → 1.51.0, while `handle` alone remains 1.50.0. Fix provider-name uniqueness in the router against all visible candidates for that id before eligibility filtering. No platform `call` or `channel` provider is introduced.

**Shared wire vocabulary.** Define these types in `src/ipc/capability-bus-channels.ts`; use them on all three transports. A provider is a plain public projection of main's registration (including `name`, methods and filters); it must not expose board roots or main-only state. A key identifies an exact registration, including its generation-bearing handler key:

```ts
export interface CapabilityKey { id: string; version: number; provider: string; handlerKey: string }
export interface CapabilityClientOptions { version?: number; provider?: string; filter?: { mime?: string; representation?: string } }
export type CapabilityProvider = CapabilityKey & { name: string; origin: "board" | "platform"; title?: string; priority: number; accepts?: readonly string[]; representation?: string; methods: Readonly<Record<string, CapabilityMethod>> };
export interface CapabilityClientInvoke { requestId: string; key: CapabilityKey; method: string; args: unknown[] }
export type CapabilityClientResult<T> = { ok: true; value: T } | { ok: false; error: { code: CapabilityErrorCode; message: string } };
```

`CapabilityErrorCode` here must be the **new** closed union from `src/shared/capability-contract.ts`, not the older same-named legacy union in `capability-bus-channels.ts`; alias the import. JSON, errors, deadlines and channel semantics follow the contract. `filter` must travel with every invocation as well as resolution: add `filter?: CapabilityClientOptions["filter"]` to `CapabilityClientInvoke` and reconstruct it into main's `BoundCapability`; validate the payload against it. No client-provided caller, root, context chain or registration body is trusted. In-flight request IDs are scoped to the actual owner and are cancelled on owner closure, revocation or explicit cancel.

**Proxy builder.** Add `src/shared/capability-client.ts` for the renderer and shim (the shim's Vite IIFE build bundles this pure module). The separately launched `.mjs` host cannot import TypeScript; duplicate this small pure builder in `assets/module-service-host.mjs`, with a comment linking the source and an explicit parity check in the service manual checks. Do not use runtime TS imports in the host or add a new packaging pipeline. The sketch deliberately makes only declared methods callable, freezes the provider snapshot, and prevents Promise assimilation:

```ts
export function createCapabilityProxy(provider: CapabilityProvider,
    invoke: (method: string, args: unknown[]) => Promise<unknown>): CapabilityProxy {
    const proxy: Record<string, unknown> = { provider: Object.freeze(provider) };
    for (const method of Object.keys(provider.methods)) {
        if (method === "then") continue;
        proxy[method] = (...args: unknown[]) => invoke(method, args);
    }
    return Object.freeze(proxy) as CapabilityProxy;
}
```

The contract reserves `provider` and `then` in new declarations; synthesized legacy names remain unaffected. The defensive `then` check prevents promise assimilation. The builder's callback dispatches by the declaration kind: `call` and `open` use invocation RPC; `channel` uses the corresponding channel path. A proxy's key and filter remain fixed; no retry or fallback upon stale invocation.

## Implementation Plan

Each phase is a separate deliverable, changes at most eight production files, and ends with the three commands. No unit tests or harnesses. Use Persephone MCP `call` with `script.execute` or settings-gated `main.script.execute`; execute long operations asynchronously and inspect later. Use real target window webContents for router calls. Restore grants/settings after manual checks. Put any new tuning values in the existing block in `src/shared/capability-limits.ts`.

### 1a. Renderer discovery, binding, call and open

Files: `src/ipc/capability-bus-channels.ts`, `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, `src/main/capability-router.ts`, `src/renderer/api/capabilities.ts`, `src/shared/capability-contract.ts`, **new** `src/shared/capability-client.ts`.

- [x] In `src/shared/capability-contract.ts`, reject `provider` and `then` in new `methods` declarations, using the existing invalid-method diagnostic so Board Info reports the rejected declaration. Leave synthesized legacy method names unaffected.

```ts
// before
if (!identifier.test(name) || name.length > MAX_CAPABILITY_METHOD_NAME_LENGTH || name === "providers" || name === "$help" || !record(value)) { error = "Invalid method name or definition."; break; }
// after
if (!identifier.test(name) || name.length > MAX_CAPABILITY_METHOD_NAME_LENGTH || name === "providers" || name === "$help" || name === "provider" || name === "then" || !record(value)) { error = "Invalid method name or definition."; break; }
```

- [x] Add shared types above. Main resolves to public provider metadata; `get` returns null for no match. Main reconstructs `{caller, registration, filter}` from an exact current key, checks every key field and calls `authorize` through `invoke`; never accept `BoundCapability` from IPC. Fix name uniqueness against `providers(caller,id)` before version/filter selection. `legacy: true` is reserved for phase 4.
- [x] Extend `Endpoint` and `MainApi` in `src/ipc/api-types.ts` (before: `getCapabilityIndex`; after the following typed endpoints). Use `CapabilityClientResult` to preserve code/message instead of Electron's lossy thrown errors. `capabilityCancel` is scoped to the sending window's live request id; no binding table.

```ts
// before
getCapabilityIndex = "getCapabilityIndex",
// after
getCapabilityIndex = "getCapabilityIndex",
capabilityList = "capabilityList", capabilityProviders = "capabilityProviders",
capabilityGet = "capabilityGet", capabilityInvoke = "capabilityInvoke", capabilityCancel = "capabilityCancel",
// MainApi members (imports omitted)
[Endpoint.capabilityList]: () => Promise<CapabilityClientResult<CapabilityProvider[]>>;
[Endpoint.capabilityProviders]: (id: string) => Promise<CapabilityClientResult<CapabilityProvider[]>>;
[Endpoint.capabilityGet]: (id: string, options?: CapabilityClientOptions) => Promise<CapabilityClientResult<CapabilityProvider | null>>;
[Endpoint.capabilityInvoke]: (request: CapabilityClientInvoke) => Promise<CapabilityClientResult<CapabilityJson>>;
[Endpoint.capabilityCancel]: (requestId: string) => Promise<void>;
```

- [x] `src/ipc/main/core-handlers.ts`: extend `Controller` and its `bindEndpoint` registrations; reuse the `getCapabilityIndex` main-frame/open-window sender guard, set caller `{kind:"platform"}` and target `event.sender`, wrap errors with their code and message. Track only active invocation AbortControllers per sender/request; cancel and delete on settlement or sender loss. Reject duplicate request ids. New invoke here handles `call`/`open` only; channel is phase 1b.

```ts
// before
getCapabilityIndex = async (event: IpcMainEvent) => { /* sender guard; snapshot */ }
// after (methods also bound with bindEndpoint)
capabilityGet = async (event: IpcMainEvent, id: string, options?: CapabilityClientOptions) =>
    resultOf(() => publicProvider(capabilityRouter.resolve(platformCaller(event), id, options)));
capabilityInvoke = async (event: IpcMainEvent, request: CapabilityClientInvoke) =>
    invokeForWindow(event, request); // exact-key lookup, abort ownership, router.invoke
```

- [x] `src/ipc/renderer/api.ts`: wrap endpoints using `executeOnce`, unwrap `CapabilityClientResult` to `Error` carrying `code`. `src/main/capability-router.ts`: add exact-key rebind function and fix provider name ambiguity as above.

```ts
// renderer/api.ts before
getCapabilityIndex = async () => executeOnce(Endpoint.getCapabilityIndex);
// after
capabilityGet = (id: string, options?: CapabilityClientOptions) => executeOnce(Endpoint.capabilityGet, id, options);
capabilityInvoke = (request: CapabilityClientInvoke) => executeOnce(Endpoint.capabilityInvoke, request);
// add corresponding list, providers, cancel wrappers and unwrap results at the client
```

```ts
// capability-router.ts before
const keys = new Set(candidates.filter((entry) => entry.provider === options.provider || entry.name === options.provider).map((entry) => entry.provider));
// after: name ambiguity is checked against all visible versions/filters, then eligible candidates
const visible = this.providers(caller, id);
const keys = matchingProviderKeys(visible, options.provider);
candidates = candidates.filter((entry) => keys.size === 1 && keys.has(entry.provider));
// add bindKey(caller, key, filter): BoundCapability | null; invoke still reauthorizes
```

- [x] `src/renderer/api/capabilities.ts`: add `get`/`providers`, use the shared builder and a fresh request ID for each call; preserve existing list/handlers/invoke. Prevent channel from being mistaken for JSON until 1b (reject `no-handler` with clear message).

```ts
// before
class Capabilities implements ICapabilities {
// after
class Capabilities implements ICapabilities {
    async get(id: string, options?: CapabilityClientOptions) {
        const provider = unwrap(await api.capabilityGet(id, options));
        return provider && createCapabilityProxy(provider, (method, args) => invokeSelected(provider, options?.filter, method, args));
    }
    async providers(id: string) { return unwrap(await api.capabilityProviders(id)); }
```

- [ ] MCP: (1) `script.execute`: `await app.capabilities.get("claudetest.echo")` → provider metadata and no startup from discovery. (2) `await cap.echo("hello")` → JSON with platform caller. (3) get missing id or explicit missing provider → null. (4) `slow` and `late` → timeout and no-handler; `fail` → provider's result/error, not an agent visibility denial. (5) `get("text.open").open({content:"x",language:"text",title:"x"})` → page in the calling window; untrust a bound provider → stale invocation rejects.
- [x] `npm run typecheck`; `npm run lint`; `npm run build-prod`.

### 1b. Renderer channel transport and script declarations

Files: `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, `src/ipc/renderer/api.ts`, `src/main/module-service-supervisor.ts`, `src/renderer/api/capabilities.ts`, `src/renderer/api/types/capabilities.d.ts`.

- [x] Reuse `connectHostServiceChannel` / `eBoardServiceChannel` and the existing renderer port listener pattern in `src/renderer/ui/speech/SpeechTranscriptionProvider.ts`. The existing endpoint only accepts v1 legacy selectors and its supervisor function enforces `HOST_SERVICE_CHANNEL_POLICIES`; it cannot serve arbitrary new capabilities unchanged. Add a discriminated `{kind:"capability", request: CapabilityClientInvoke}` variant to that **same endpoint**, retain the old request unchanged, and dispatch the new variant through `capabilityRouter.bindKey` + `invoke`. Adapt `openCapabilityChannel` to deliver the consumer port using the existing `eBoardServiceChannel` channel/id correlation, while preserving router authorization, deadlines and close/revocation. Do not send the main-side channel object over IPC. Keep legacy allowlist for the old variant only.

```ts
// src/ipc/api-types.ts before: existing connectHostServiceChannel request
{ interfaceId: string; provider: string; version: number; openMessage: unknown }
// after: retain that request and add
{ kind: "capability"; request: CapabilityClientInvoke }
```

```ts
// src/ipc/main/board-handlers.ts before
return (await import("../../main/module-service-supervisor")).moduleServiceSupervisor.connectHostServiceChannel(event.sender, request, request.openMessage);
// after, after the existing sender guard
if ("kind" in request && request.kind === "capability") return openRendererCapabilityChannel(event.sender, request.request);
return moduleServiceSupervisor.connectHostServiceChannel(event.sender, request, request.openMessage);
```

```ts
// src/ipc/renderer/api.ts before
connectHostServiceChannel = async (request: { interfaceId: string; provider: string; version: number; openMessage: unknown }) =>
    executeOnce<string>(Endpoint.connectHostServiceChannel, request);
// after: accept the union above, keep Endpoint and string channelId
connectHostServiceChannel = async (request: HostServiceChannelRequest) => executeOnce<string>(Endpoint.connectHostServiceChannel, request);
```

```ts
// src/main/module-service-supervisor.ts before
async openCapabilityChannel(boardRoot: string, consumer: string, consumerServiceRoot: string | undefined, openMessage: unknown,
// after: add a delivery option to the existing operation; post the consumer port
// to target using EventEndpoint.eBoardServiceChannel and return its channelId
async openCapabilityChannel(boardRoot: string, consumer: string, consumerServiceRoot: string | undefined, openMessage: unknown,
```

```ts
// src/renderer/api/capabilities.ts before
return provider && createCapabilityProxy(provider, (method, args) => invokeSelected(provider, options?.filter, method, args));
// after: invokeSelected checks provider.methods[method].kind; channel uses
// api.connectHostServiceChannel({ kind: "capability", request }) then wraps the correlated port.
```

- [x] `src/renderer/api/types/capabilities.d.ts`: add self-contained `CapabilityJson`, error, method, provider, channel, options, proxy and `ICapabilities.get/providers` types, preserving synchronous legacy members. `vite.renderer.config.ts` copies this source to `assets/editor-types/capabilities.d.ts` at dev/build time; retain that existing generation path.

```ts
// src/renderer/api/types/capabilities.d.ts before
export interface ICapabilities {
// after
export interface ICapabilities {
    get(id: string, options?: CapabilityOptions): Promise<CapabilityProxy | null>;
    providers(id: string): Promise<readonly CapabilityProvider[]>;
```

- [ ] MCP: (1) `script.execute` get a currently trusted `text.translate` provider → named `describe` channel available. (2) call `describe({})` → channel, attach listener immediately, receive provider response. (3) `send` and close → ordered delivery and close notification. (4) revoke provider during channel → closure and rejected writable waiter. (5) inspect script editor IntelliSense after `npm run build-prod` → `get` and `providers` remain present; existing voice typing host connection still opens through the legacy endpoint.
- [x] `npm run typecheck`; `npm run lint`; `npm run build-prod`.

### 2. Board-service client

Files: `src/ipc/module-service-channels.ts`, `src/main/module-service-supervisor.ts`, `src/main/capability-router.ts`, `assets/module-service-host.mjs`, `src/main/capability-channel.ts`.

- [x] Add client messages adjacent to the existing provider `capability-call/result/cancel` wire in `src/ipc/module-service-channels.ts`. `parentRequestId` is the current inbound handler request from `AsyncLocalStorage`, not a caller identity; supervisor verifies that the request belongs to this exact running service generation before using it. Outside a handler omit it. `list` and `providers` use `capability-client-discover`; all replies use one correlated result message. A channel's consumer port is transferred separately with `capability-client-port`, correlated by requestId; use the existing channel framing, not JSON.

```ts
// before: ServiceMainMessage includes capability-result for provider calls
| { kind: "capability-result"; requestId: string; result: CapabilityJson }
// after: add service → main messages
| { kind: "capability-client-discover"; requestId: string; id?: string }
| { kind: "capability-client-resolve"; requestId: string; id: string; options?: CapabilityClientOptions }
| { kind: "capability-client-invoke"; request: CapabilityClientInvoke; parentRequestId?: string }
| { kind: "capability-client-cancel"; requestId: string }
// ServiceParentMessage add main → service:
| { kind: "capability-client-result"; requestId: string; result: CapabilityClientResult<CapabilityProvider[] | CapabilityProvider | CapabilityJson | null> }
| { kind: "capability-client-port"; requestId: string } // transferred port in event.ports[0]
```

- [x] `src/main/module-service-supervisor.ts`: handle these messages only from the `record.process` and current `record.generation`; derive `caller = {kind:"board-service", provider:boardRootKey(record.boardRoot)}`. Resolve/list through router, exact-key rebind for invoke, answer with `capability-client-result`, transfer a channel consumer port for a channel method, and store only in-flight request controllers keyed by record/generation/id. Validate `parentRequestId` belongs to the active provider call delivered to this same process before passing it to `createInvocationContext`. Recheck authorization; cancel on exit, trust/grant changes and timeout, ignore late responses.

```ts
// before: provider result handling
if (capabilityMessage?.kind === "capability-result") {
// after: also handle authenticated service-originated client requests
if (capabilityMessage?.kind === "capability-client-resolve") {
    void replyCapabilityResolve(record, process, generation, capabilityMessage);
}
if (capabilityMessage?.kind === "capability-result") {
```

```ts
// src/main/capability-router.ts before
createInvocationContext(bound: BoundCapability, input: Omit<CapabilityCallContext, "invocation"> = {}): MainCapabilityInvocationContext {
// after: entrypoint verifies parent ownership before accepting parentRequestId;
// derive inherited ancestry and originating window from main's invocationContexts.
createInvocationContext(bound: BoundCapability, input: Omit<CapabilityCallContext, "invocation"> = {}): MainCapabilityInvocationContext {
```

```ts
// src/main/capability-channel.ts before
export function createCapabilityChannel(port: MessagePortMain, onEnd: () => void) {
// after: retain this main handle and expose the consumer-port delivery adaptation
// used by the supervisor; keep acknowledgements, limits and cleanup unchanged.
export function createCapabilityChannel(port: MessagePortMain, onEnd: () => void) {
```

- [x] `assets/module-service-host.mjs`: add request map, response/port correlation, cancellation and the duplicated pure builder. Add `AsyncLocalStorage` from `node:async_hooks` and wrap each `runCapabilityCall` handler invocation with its authenticated request id; concurrent async calls must not share context. `capabilities.handle` remains synchronous; `getCapability`, `list`, `providers` can be called after startup. Channel wraps the received port with the existing service channel protocol. For service-origin open use inherited originating window; if absent, most recently focused normal window, else `no-handler`.

```js
// before
const result = await handler(message.args, {
// after
const result = await capabilityContext.run({ parentRequestId: message.requestId }, () => handler(message.args, {
    signal: controller.signal, caller: message.caller,
}));
// retain the other existing ctx fields if provider-facing compatibility requires them
// before
persephone.capabilities = { handle(id, method, handler) {
// after: keep handle; add list/providers and persephone.getCapability using the wire above
```

- [ ] **Manual fixture**, created only during the checks at `<data directory>/scratch/US-1795-consumer/`: `board-manifest.json` must have `schemaVersion: 1`, `name`, `service: "service.mjs"`, `permissions: { "service": true }`, `uses: [{ "id": "claudetest.echo", "version": 1 }]`, `minBridgeVersion: "1.51.0"`, and a valid `capabilities` declaration `id: "scratch.consumer"`, version 1, with call method `relay`, summary and one argument descriptor `value`. Create `index.html` in the board root for phase 3; the template has no manifest `entry` field. Ten-line `service.mjs`:

```js
persephone.capabilities.handle("scratch.consumer", "relay", async ([value], ctx) => {
  const echo = await persephone.getCapability("claudetest.echo");
  if (!echo) {
    throw Object.assign(new Error("echo unavailable"), { code: "no-handler" });
  }
  const result = await echo.echo(value);
  return { result, caller: ctx.caller };
});
// All registrations are synchronous, before any awaited initialization.
// This scratch service is removed after the page checks in phase 3.
```

- [ ] MCP: (1) `main.script.execute` inspect the trusted scratch board with `capabilityRouter.providers({kind:"platform"}, "scratch.consumer")` → one provider; discovery does not start it. (2) `script.execute` get `scratch.consumer` and invoke `relay("hello")` → nested echo reports authenticated board-service caller and relay reports platform caller. (3) Remove its `uses` grant then invoke `relay` → unavailable/permission denied; restore grant. (4) Invoke provider `slow` and `late` via a temporary relay edit → timeout and no-handler, and compare metadata/proxy names with renderer and verify the host proxy builder stays in parity with `src/shared/capability-client.ts`. (5) Invoke two concurrent relay calls → distinct results/context; cancel one caller → its work is cancelled without cancelling the other.
- [x] `npm run typecheck`; `npm run lint`; `npm run build-prod`.

### 3. Board-page client and bridge version

Files: `src/ipc/board-bridge-channels.ts`, `src/main/board-bridge.ts`, `src/board-shim.ts`, `src/main/module-service-supervisor.ts`, `src/shared/board-bridge-version.ts`, `assets/guides/agents/capabilities.md`.

- [x] Use the existing `{kind:"rpc", id, method, args}` / `rpc-result` board port envelope in `src/ipc/board-bridge-channels.ts`. Define typed argument tuples/results alongside `BoardRpcMethod`, including filter and key, with the same `CapabilityClientResult` vocabulary. Channel delivery uses the existing service channel transfer to the board frame and `waitForServiceChannel(channelId)`; do not serialize a MessagePort. The request ID is frame-scoped and cancellation addresses only that frame's active request.

```ts
// before
| "servicesList"
| "servicesConnect"
// after
| "servicesList"
| "servicesConnect"
| "capabilityList" | "capabilityProviders" | "capabilityGet" | "capabilityInvoke" | "capabilityCancel"
// args/results: list [] → Provider[]; providers [id] → Provider[];
// get [id, options?] → Provider | null; invoke [CapabilityClientInvoke] → Json | {channelId: string};
// cancel [requestId] → void. rpc-result carries result or code/message.
```

- [ ] `src/main/board-bridge.ts`: add handlers to `boardRpcHandlers`, derive board-page caller with `boardRootKey(entry.root)` and owner `entry.hostWebContents`; check current entry token/port, trust and exact `uses` through router. `capabilityList` and `providers` do not check `appScripting`. Key lookup and reauthorization are main-owned. Track only active operations per frame and cancel on dispose; reject duplicate IDs. For nested page intents, map the active request to main's trusted request context through the renderer's existing request-bound frame tracking; never accept arbitrary chain, caller or parent from page content.

```ts
// before
async servicesList(entry, args) {
// after: alongside the unchanged legacy handler
capabilityList: (entry) => capabilityRouter.list(boardCaller(entry)).map(publicProvider),
capabilityGet: (entry, [id, options]) => publicProvider(capabilityRouter.resolve(boardCaller(entry), id, options)),
// capabilityProviders, capabilityInvoke and capabilityCancel use the same authenticated entry
async servicesList(entry, args) {
```

```ts
// src/main/module-service-supervisor.ts before
async openCapabilityChannel(boardRoot: string, consumer: string, consumerServiceRoot: string | undefined, openMessage: unknown,
// after: support the board frame's existing channel delivery/correlation and close on frame disposal,
// while new channels still pass through router authorization and reauthorization.
```

- [x] `src/board-shim.ts`: import the shared pure builder, implement RPC methods and channel wait; retain legacy `capabilities.invoke`. Replace board `capabilities.list` implementation with the new unified RPC. Preserve existing `services.list/connect` unchanged.

```ts
// before
capabilities: {
    list(): Promise<unknown> { return capabilityListRpc(); },
// after
getCapability: getCapabilityRpc,
capabilities: {
    list: () => rpc("capabilityList", []),
    providers: (id: string) => rpc("capabilityProviders", [id]),
```

```ts
// src/shared/board-bridge-version.ts before
export const BOARD_BRIDGE_VERSION = "1.50.0";
// after
export const BOARD_BRIDGE_VERSION = "1.51.0";
```

```md
<!-- assets/guides/agents/capabilities.md before -->
Providers using `persephone.capabilities.handle` must set `minBridgeVersion` to `1.50.0`.
<!-- after: retain that provider minimum and add the client minimum -->
Providers using `persephone.capabilities.handle` must set `minBridgeVersion` to `1.50.0`.
Board pages and services using `getCapability` must set `minBridgeVersion` to `1.51.0`.
```

Add there: board `capabilities.list()` now returns grant-filtered unified providers without `appScripting`; no bundled or surveyed external board calls the old board list. Board pages and services consuming the new client declare `minBridgeVersion: "1.51.0"`; `handle` alone stays 1.50.0. Bundled manifests and prose guide migrations are US-1797, external manifests BT-087; publish later. This contract clarification is part of this phase, not publication.

- [ ] MCP: (1) Add `index.html` to the scratch consumer; it calls `persephone.capabilities.list()`, `getCapability("claudetest.echo")`, `echo("page")`, and displays the result; open via `script.execute` → unified granted entry and board-page caller with no `appScripting`. (2) Call `slow`/`late` from the page → timeout/no-handler. (3) Remove the echo grant and refresh trust → list hides echo and a stale proxy fails; restore it. (4) Add a `text.open` grant and call its open from the page → page in caller window; open an available granted channel → message and close events. (5) Close page during slow call → cancellation; remove trust and delete the scratch folder after checks.
- [x] `npm run typecheck`; `npm run lint`; `npm run build-prod`.

### 4. Renderer index from main, legacy selection via main, remove local candidates

Files: `src/main/capability-router.ts`, `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, `src/renderer/api/capabilities.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/api/app-service-registry.ts`, `src/renderer/editors/board/BoardWebview.ts`.

- [x] Add `legacy?: boolean` to the internal renderer-only `capabilityGet` request: `legacy: true` preserves omitted-version-across-majors, priority/platform/registration-order and ignores new preferred-provider settings, as `resolveCapability` does today. Main returns the selected **legacy dispatch registration**, including board root for trusted renderer execution, without a second resolution. Parse `@major`, apply conflict checks, payload validation and representation filter in the existing `invokeCapabilityOutcome`; preserve renderer `deadlineMs`, errors and direct handler versus board outcome projection. Board legacy invocation continues to require trust only in `BoardWebview.resolveCapabilityInvoke`; do not impose `uses` on the legacy bus. Keep legacy platform access to the resolver sender-validated and do not let board pages call it directly. Preserve `services.list/connect` entirely unchanged.

```ts
// src/main/capability-router.ts before
resolve(caller: CapabilityCaller, id: string, options: CapabilityOptions = {}): BoundCapability | null {
// after: legacy flag is accepted only from trusted renderer endpoint
resolve(caller: CapabilityCaller, id: string, options: CapabilityOptions & { legacy?: boolean } = {}): BoundCapability | null {
    // legacy: omitted version matches all; skip preference, then old priority/tie rules.
    // normal path remains version 1 by default and honors preference.
```

```ts
// src/ipc/api-types.ts before (phase 1a)
[Endpoint.capabilityGet]: (id: string, options?: CapabilityClientOptions) => Promise<CapabilityClientResult<CapabilityProvider | null>>;
// after: separate typed legacy result, for trusted renderer only
[Endpoint.capabilityLegacyResolve]: (id: string, options: LegacyCapabilityResolveOptions) => Promise<CapabilityClientResult<CapabilityRegistration | null>>;
// add capabilityLegacyResolve = "capabilityLegacyResolve" to Endpoint
```

```ts
// src/ipc/main/core-handlers.ts before (phase 1a)
capabilityGet = async (event: IpcMainEvent, id: string, options?: CapabilityClientOptions) =>
    resultOf(() => publicProvider(capabilityRouter.resolve(platformCaller(event), id, options)));
// after: add a sender-validated endpoint; translate main registration to legacy dispatch shape
capabilityLegacyResolve = async (event: IpcMainEvent, id: string, options: LegacyCapabilityResolveOptions) =>
    resultOf(() => legacyRegistration(capabilityRouter.resolve(platformCaller(event), id, { ...options, legacy: true })));
// register with bindEndpoint
```

```ts
// src/ipc/renderer/api.ts before
getCapabilityIndex = async () => executeOnce(Endpoint.getCapabilityIndex);
// after: add
capabilityLegacyResolve = (id: string, options: LegacyCapabilityResolveOptions) => executeOnce(Endpoint.capabilityLegacyResolve, id, options);
```

- [x] Subscribe to snapshot/change events before fetching `getCapabilityIndex`. Initialize before exposing synchronous legacy discovery, retain highest revision, and refetch when a newer notification overtakes a response. Project `list()` and `handlers()` to the exact historical fields, ordering and filter behavior; main's unified registry also includes service-only declarations, so filter/project legacy bus entries correctly. If merged normalized entries lack information to reconstruct the legacy bus registrations or board root, extend main's snapshot with explicit legacy projection from the trusted source; do not silently expose service-only entries or treat the renderer as authoritative. Remove `candidates`, `addCandidate`, local `resolveCapability`, `registerCapability` and `unregisterBoardCapabilities`; retain built-in handler construction and bound open listener, `capabilityBus` execution and `boardCapabilityTransport` unchanged.

```ts
// src/renderer/api/capabilities.ts before
const registration = resolveCapability(parsed.bareId, version, filter);
// after
const registration = unwrap(await api.capabilityLegacyResolve(parsed.bareId, { version, filter }));
// before
[...candidates.values()].flat().sort((left, right) => left.order - right.order).map(copyInfo)
// after
projectLegacyList(mainIndexSnapshot)
```

```ts
// src/renderer/editors/board/custom-editor-registry.ts before
unregisterBoardCapabilities();
replaceProviderDeclarations(providerAxis.declarations);
commitUrlMaskAxis(urlMaskIssues, registrationIssues);
commitCapabilityAxis(capabilityAxis, registrationIssues);
// after: retain capability validation/Board Info diagnostics, remove registration mutation
replaceProviderDeclarations(providerAxis.declarations);
commitUrlMaskAxis(urlMaskIssues, registrationIssues);
commitCapabilityIssues(capabilityAxis, registrationIssues);
```

```ts
// src/renderer/api/app-service-registry.ts before
registerBoundOpenDispatch();
// after: subscribe before fetch and await initial index before service initialization resolves
registerBoundOpenDispatch();
await initializeCapabilityIndex();
```

```ts
// src/renderer/editors/board/BoardWebview.ts before
const invocation = await invokeCapabilityOutcome(message.id, message.payload, {
// after: retain the trust-only check and request-bound settlement;
// invokeCapabilityOutcome now asks main for the selection.
const invocation = await invokeCapabilityOutcome(message.id, message.payload, {
```

Remove the old board `resolveCapabilityList` route only when shim clients no longer use it; keep the old invoke route, its trust-only authorization and its settlement. Preserve trust revocation checks, request-bound FIFO, `discardPage`, fresh page rules and same-window reuse. Old script registration behavior/legacy ordering must remain observable even though the authoritative candidates come from main.

- [ ] MCP: (1) `script.execute` compare `app.capabilities.list()`/`handlers("content.view")` in two windows → same legacy projection/order as before, without service-only entries. (2) `app.capabilities.invoke("text.open", payload)` → old result shape in caller window. (3) From Excalidraw invoke its existing `content.view` → page/result and reuse remain unchanged; open REST Client through its old entry point → prior behavior. (4) Disable/untrust and re-enable a board → next snapshot removes then restores its legacy registration in both windows. (5) `persephone.services.list/connect` in an existing granted board → existing channel and provider selector still work; a trusted board invokes the legacy bus without `appScripting` → succeeds as before.
- [x] `npm run typecheck`; `npm run lint`; `npm run build-prod`.

## Concerns

- Main's normalized index merges legacy service and bus declarations. Preserving synchronous legacy discovery may require the explicit main-owned legacy projection described in phase 4; adding its storage must stay within the phase's file budget by splitting that phase if needed. No renderer-side rebuild becomes a second source of truth.
- `connectHostServiceChannel` currently enforces the host allowlist and v1, whereas new clients have platform access without that restriction. Phase 1b extends the same endpoint and port delivery with a distinct router-authorized variant; the old variant remains unchanged. Router's `openCapabilityChannel` currently returns a main-side wrapper, so supporting transfer requires a concrete delivery adaptation and correct lifecycle ownership.
- Validate request IDs and active parent ownership to prevent cross-window/frame/service cancellation or chain spoofing.

## Acceptance Criteria

- [ ] Board pages and services provide `getCapability`, grant-filtered async `capabilities.list/providers` and contract method shapes; renderer provides `get/providers` and keeps synchronous legacy discovery.
- [ ] New methods reauthorize the authenticated caller on each invocation, use exact registration keys, respect trust and `uses`, and do not require `appScripting`; lifecycle, chain, errors, channel backpressure and deadlines follow the contract.
- [ ] Existing service APIs are unchanged. Legacy bus selection and discovery come from main while renderer execution and compatibility semantics stay intact.
- [ ] Board bridge version is 1.51.0 for both clients; `handle` remains 1.50.0; consumer guidance is updated. Editor types survive production build.
- [ ] Each phase's MCP checks and `npm run typecheck`, `npm run lint`, `npm run build-prod` pass. No unit tests or test harnesses.

## Files needing no changes

`src/renderer/editors/board/board-api.d.ts` is not maintained. `src/shared/platform-capabilities.ts` and `src/main/board-root-key.ts` need no edits; `src/shared/capability-limits.ts` changes only if new limits are needed. `src/renderer/api/capability-bus.ts` and `src/renderer/api/board-capability-transport.ts` retain legacy execution. Agent call-tree files, bundled manifests, `doc/architecture/capability-bus.md` migration and external boards are later tasks.

## Files Changed

| Path | Planned change |
|---|---|
| `src/ipc/capability-bus-channels.ts`, `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts` | Shared wire, authenticated renderer IPC, legacy resolve and snapshot access. |
| `src/main/capability-router.ts`, `src/main/capability-channel.ts`, `src/main/module-service-supervisor.ts` | Exact-key rebind, name fix, client calls, delivery and lifecycle. |
| `src/ipc/module-service-channels.ts`, `assets/module-service-host.mjs` | Service client wire, async ancestry, proxy. |
| `src/ipc/board-bridge-channels.ts`, `src/main/board-bridge.ts`, `src/board-shim.ts` | Page client RPC, authenticated dispatch and proxy. |
| `src/shared/capability-client.ts` | New pure proxy builder shared by renderer and shim; host mirrors it. |
| `src/renderer/api/capabilities.ts`, `src/renderer/api/app-service-registry.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/editors/board/BoardWebview.ts` | Renderer client, main snapshot, legacy resolve and preserve execution. |
| `src/ipc/main/board-handlers.ts` | Extend existing host channel endpoint with router-authorized variant. |
| `src/renderer/api/types/capabilities.d.ts` | Script declarations; the existing build copies them to `assets/editor-types/capabilities.d.ts`. |
| `src/shared/capability-contract.ts` | Reject reserved method names in new declarations, preserving legacy synthesis. |
| `src/shared/board-bridge-version.ts`, `assets/guides/agents/capabilities.md` | Shared 1.51.0 bump, migration clarification and consumer version. |

## Notes (verification, 2026-11-07)

Checked by hand through Persephone MCP with two scratch boards (`claudetest.echo` provider, `claudetest.consumer` consumer with `uses` for echo only, no `appScripting`):

- Renderer: `app.capabilities.get` call (`echo`, `slow` → timeout, `late` → no-handler, `fail` → provider code), `null` for unknown id and unknown provider, `open` on `text.open` returns a `pageId`, proxy has no `then`; `text.translate` channel `describe` delivers its message and `onClose` fires `channel-closed`.
- Board service: nested `echo` from a handler sees caller `board-service`, outer sees `platform`; inner `slow` times out; `capabilities.list()` shows only the granted id; ungranted `getCapability("text.open")` is `null`.
- Board page (bridge 1.51.0): same results with caller `board-page`.
- Legacy after phase 4: `app.capabilities.list()` 12 entries, `handlers`, `app.capabilities.invoke("text.open")`, board-page `persephone.capabilities.invoke("content.view")` (trust only) all work.

Not exercised: revocation in flight, concurrent cancel, reload during a slow call, two windows.

**Deferred:** phase 3's nested page-intent ancestry (a page opened by an intent that then calls a capability does not carry the parent chain to main, so cycle detection does not span that hop). Revisit if a real cycle appears.

**For BT-087 / provider caller policy:** `ctx.caller.id` for board callers is the existing `author/name` caller id, which two trusted boards can share; providers that authorize by caller should use something stronger.
