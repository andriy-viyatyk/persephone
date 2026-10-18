# US-1711: Board settings from a module service

## Goal

Expose the board's declared settings to its host-managed module service through `persephone.settings.get(id)` and `persephone.settings.onChange(callback)`. Reuse the page bridge's renderer-owned settings path so the service gets the same board namespace, manifest defaults, validation, errors, and effective change values.

## Background

### Verified current behavior

- The page shim exposes `persephone.settings.get(id)` and `onChange(cb)` in `src/board-shim.ts`. `get()` sends `board:settings` over the board's host port; its result handler rejects an error string and requires a finite scalar result. The shim receives `settings:changed` messages and invokes callbacks with `{ id, value }`.
- `src/renderer/editors/board/BoardWebview.ts` handles `board:settings` by calling `resolveBoardSettingsRequest(this.props.boardRoot, "get", args)` and replies to the originating frame. Its `settings:changed` subscription calls `subscribeBoardSettings` and posts the effective change to that same frame. The page settings handler has no permission gate; board trust and the existing service grant remain the service boundary.
- `src/renderer/api/board-settings/board-settings-bridge.ts` owns the shared behavior. `resolveDeclaration()` reads the manifest, normalizes declarations, rejects missing stable identity and unknown/malformed ids, and resolves the namespace. `readEffectiveBoardSetting()` uses the stored value when present and validates it against the declaration; otherwise it returns `declaration.default`. `resolveBoardSettingsRequest()` serializes reads, validates the id, and returns `{ result }` or `{ error }`. `subscribeBoardSettings()` filters by the board namespace and declaration, resolves stored-or-default effective values, validates them, and emits `{ id, value }`.
- `src/renderer/api/board-namespace.ts` resolves stable manifests to the trimmed `author/name` identity. Bundled boards without stable identity use `bundled:<folder-id>`; other fallback cases use the board root. The settings bridge requires stable identity for declared settings, so service requests must reuse the settings bridge rather than independently constructing a namespace.
- `src/renderer/api/board-settings/BoardSettingsStore.ts` owns a renderer-lifetime model of the shared `board-settings.json` file. Each window has a separate renderer process and store instance. `get()` is queued and awaits `ensureLoaded()`; the first read waits for `fs`, restores/parses the file, and propagates load errors. `TextFileModel` watches its source; its state subscription calls `reloadFromModel()`, which compares parsed data and notifies listeners for external file edits. Settings page set/reset use the same store, and store notifications include namespace, id, and the changed stored value (reset may have no value); `subscribeBoardSettings()` converts these into effective values including defaults. Important: `subscribeBoardSettings()` only registers an `onChanged` callback; it does not call `ensureLoaded()` or start the file watch.
- **Cross-window watch verified.** `FileProvider.watch()` in `src/renderer/content/providers/FileProvider.ts` subscribes through `src/renderer/api/path-watch.ts`; each renderer sends its own `Endpoint.subscribePathWatch` request. `src/ipc/main/path-watch-handlers.ts` keeps subscriptions by sender `WebContents`, and the main-process singleton `PathWatchService` shares filesystem watcher records and dispatches each batch back to each subscribed sender. Therefore, when the chosen renderer has loaded its settings store, it receives file changes made through another window's separate renderer process. The service renderer adapter must first initialize/load the store (and wait for success) before calling `subscribeBoardSettings()` so its file watch exists.
- The normal module-service request path is service host → `ServiceMainMessage` → `routeProcessMessage()` → `ModuleServiceSupervisor` → utility-process response. The supervisor's `request()` starts the service lazily, tracks pending requests per `ServiceRecord`, applies `SERVICE_REQUEST_DEADLINE_MS`, and `rejectRequests()` settles outstanding work during teardown. Host API requests already have structured `{ code, message }` service errors. The service's optional renderer `MessagePort` lease is a separate high-volume provider path and is not required for ordinary requests.
- Main-to-renderer work currently uses `MCP_EXECUTE`/`MCP_RESULT` in `src/main/mcp/renderer-bridge.ts`, but that path is inappropriate for service settings: MCP commands are externally reachable, count as MCP activity, and are cancelled with MCP shutdown. Do not add a service settings command to `src/renderer/api/mcp/command-registry.ts`, and do not use `mcp-handler.ts`. Reuse only the renderer selection/readiness behavior: select a live window, await its `whenReady`, and bound the request. If useful, factor that behavior into a helper without changing MCP behavior. The service path needs dedicated, narrowly typed main-to-renderer get/subscribe/unsubscribe request/reply channels and a renderer-to-main settings-change event.
- The dedicated renderer handler receives its work through Electron IPC from main, not through the board iframe bridge. `ipcRenderer` listeners are scoped to that renderer `WebContents`; a cross-origin board iframe cannot send or forge those IPC events and only has its shim `MessagePort`. Still validate each main-supplied board root against registered/trusted or bundled board roots before reading. The renderer change event must carry a main-issued subscription token, not a caller-selected board root or namespace; register its main listener with `guardedIpcOn`.
- The renderer's `getBoardSetting()` and `subscribeBoardSettings()` are the functions to call for service reads and subscriptions. `getBoardSetting()` uses the same `readEffectiveBoardSetting()` logic and awaits the lazy store load. The exact unknown-id message is `Unknown or malformed board setting "<id>".` The page shim turns the bridge reply error string into a rejected `Error`; the service host should reject with that same message while preserving its standard structured service error envelope.
- `ModuleServiceSupervisor.applyBoardServiceTrustSnapshot()` retains each service's canonical `boardRoot`, checks trust and the normalized `service` permission before start/request, and stops records on untrust or permission loss. The utility process cannot choose its settings namespace: every settings operation must be routed using the `ServiceRecord` associated with the sending process and generation. Do not accept a board root or namespace from the service message.
- `assets/module-service-host.mjs` owns the host API service facade and currently bridges storage and private-MCP endpoint requests to main. The MCP endpoint pattern uses a request id, bounded pending map/timer, matching response, and cleanup during shutdown. The service host already owns `persephone.service` APIs, making its facade the service-side home for `settings`.
- Bridge `1.42.0` is already present as `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts`; `package.json` is app `5.0.13`. `assets/guides/whats-new.md` labels `5.0.13` Upcoming. This is still unreleased: append service settings to the existing 1.42.0 entry and do not bump either version.

### Routing and lifecycle decisions

1. A service `get` request travels over dedicated service IPC to main; main obtains the board root from the current service record and sends a typed get request to a renderer. The renderer validates that main-supplied root against its registered/trusted or bundled board roots, then invokes `getBoardSetting()` so declaration parsing, namespace resolution, store load, default merge, value validation, and error text stay centralized. A missing/unregistered root is rejected before the read.
2. For a read, select the first live renderer and await its `whenReady`; do not open a window. For multiple windows this is any application renderer, independent of whether a page for the service board is open. Bound the full request by 10 seconds. If no live renderer is available, reject with `service-exited`; if the deadline expires, reject with `service-timeout`.
3. There is exactly one renderer subscription per running service record. The service host installs it on the first local `onChange(callback)` registration and removes it when the last local callback is disposed or the service record stops. Additional callbacks are fanned out locally by the service host; they do not create extra main or renderer subscriptions. The renderer adapter awaits settings-store initialization before calling `subscribeBoardSettings()`, then reports effective `{ id, value }` changes to main. Main routes by its subscription token and forwards to only that service record's current utility process.
4. Main pins the renderer `WebContents` that installed a subscription. On renderer reload, detect `did-start-navigation`, `render-process-gone`, or `destroyed`, mark the subscription unavailable, and reinstall it on another live renderer or on the reloaded renderer after `whenReady`. The service is not notified about renderer changes, and delivery must not be silently dropped. Reject setup/reinstallation only if no renderer remains. Keep subscription tokens and messages bound to the service generation so late changes cannot reach a replacement process.
5. Remove subscriptions on last callback disposal, service exit/restart, explicit stop, untrust, service permission loss, and app quit. Settle in-flight work with `service-exited` or `untrusted`; clear timers and pending ids on every response, timeout, cancellation, renderer reload, and teardown. Use `service-timeout` for the existing 10-second service request deadline.
6. Board settings are not permission-gated in the page bridge. Do not add a new settings grant. Service access remains behind existing trusted-board and `service`-permission checks.

## Implementation Plan

- [x] **Extend the utility-process host API.** Added host-managed settings reads and change subscriptions with correlated operations, scalar/id validation, local callback fan-out, disposer cleanup, timers, and shutdown cleanup. Legacy raw-protocol entries do not receive a working settings API.
- [x] **Add dedicated IPC messages.** Added typed utility-process/main messages and a dedicated Electron IPC contract for renderer settings requests, replies, and changes; the implementation does not route through MCP.
- [x] **Route service operations through the supervisor.** The handshake routes settings messages only for the current process/generation. The supervisor derives `boardRoot` from its `ServiceRecord`, checks trust plus the `service` grant, pins renderer subscriptions, reinstalls after navigation/process loss, and settles pending work on service teardown. Tracking remains supervisor-owned, so `module-service-record.ts` needed no change.
- [x] **Add a renderer-side adapter.** Added the main-IPC adapter, board-root validation, shared settings bridge calls, and an initialization seam that loads the settings store and starts its file watcher before subscribing. The route is not exposed through board frames, the app Object Model, or MCP.
- [x] **Fan out changes to exactly one service.** Renderer changes are routed by the main-issued subscription token and current service generation to the owning service only. Scalar validation and effective defaults come from the shared settings bridge.
- [x] **Keep access ungated beyond service trust.** The supervisor applies the existing trusted-board and normalized `service` permission checks without adding a settings grant or changing the page settings gate.
- [x] **Document the service API and release.** Updated the authoring guide, board template, upcoming release notes, and architecture overview. The bridge remains `1.42.0` and the app remains `5.0.13`.
- [x] **Keep this task document's progress current during implementation.** No unit tests or test harnesses were added.

### Before → after API shape

**Service host API (`assets/module-service-host.mjs`):**

```js
// Before: service facade has service/storage/MCP APIs, but no declared board settings.
persephone.storage.get(key);

// After: settings are scoped to the service's own board by main.
const instructions = await persephone.settings.get("instructions");
const stop = persephone.settings.onChange(({ id, value }) => {
    if (id === "instructions") reloadInstructions(value);
});
// stop() removes the service's subscription.
```

**Service protocol (`src/ipc/module-service-channels.ts`):**

```ts
// Before: no settings operations in service/main protocol.
type ServiceMainMessage = { kind: "storage-request" | "mcp-endpoint-request"; /* ... */ };

// After: settings operation is correlated; board identity is record-owned in main.
type ServiceMainMessage =
    | { kind: "board-settings-get"; requestId: string; id: string }
    | { kind: "board-settings-subscribe"; subscriptionId: string }
    | { kind: "board-settings-unsubscribe"; subscriptionId: string };
```

Final message names may follow the existing protocol naming convention, but must keep these identity, correlation, and payload constraints.

## Concerns

- **Renderer loss and replacement:** main must observe the pinned `WebContents` through `did-start-navigation`, `render-process-gone`, and `destroyed`. Reinstall the settings subscription on another live renderer or after the same one is ready again; reject only if no renderer remains.
- **Fast stop/restart:** renderer replies and store changes can arrive after the utility process exits. Generation and subscription-token checks must prevent delivery to a replacement service process.
- **Error compatibility:** preserve the page-facing unknown-id and malformed-id messages while using the established structured service error transport. Do not return `undefined` for undeclared settings.
- **Version state:** `1.42.0` / `5.0.13` are unreleased in this checkout. Record this feature under the existing bridge release; no further version bump is planned.

## Acceptance Criteria

- A host-managed service can call `await persephone.settings.get(id)` and receives the same effective scalar value as the owning board page, including the current manifest default when unset.
- An undeclared or malformed id rejects with the same message and error semantics as page `persephone.settings.get(id)`; invalid stored values and settings-file load errors use the shared settings implementation.
- `persephone.settings.onChange(cb)` returns an unsubscribe function and reports exactly `{ id, value }` for settings changes and resets, with effective default values after reset.
- Settings edits through the Settings page and edits to `board-settings.json` on disk reach only that board's running service; no other board service receives the event.
- The service can read a provider board's settings when no page for that provider board is open, including a lazily started provider service requested by a cross-board consumer.
- Main derives the settings board root from the current service record, never from service message contents, and enforces existing trust plus `service` permission. No additional permission gate applies.
- Multiple windows and renderer startup are handled as documented; requests wait for an existing renderer's readiness and fail cleanly when none exists or a deadline expires.
- Pending operations and subscriptions are cleaned on unsubscribe, timeout, service exit/restart, stop, untrust, service permission loss, and quit. In-flight work settles with a structured service error.
- Exactly one renderer subscription exists per service record while local callbacks exist; the host fans out to callbacks locally and removes the subscription when the final callback is disposed.
- Renderer reload/crash of the pinned window triggers reinstallation on another live renderer or after the same renderer is ready. Change delivery is rejected only if no renderer remains.
- The exact no-renderer error code is `service-exited`; the exact request timeout code is `service-timeout`.
- The settings request uses dedicated board-service IPC, never the MCP command registry. The renderer accepts requests only over main IPC, validates the board root against registered/trusted or bundled roots, and does not expose this method to board frames.
- `assets/guides/boards.md`, `assets/board-template/CLAUDE.md`, `assets/guides/whats-new.md`, and `doc/architecture/overview.md` describe the API. The existing bridge constant stays `1.42.0` and app version stays `5.0.13`.
- No unit tests or test harnesses are added.

## Files Changed Summary

| File | Planned change |
|------|----------------|
| `assets/module-service-host.mjs` | Add service-side `persephone.settings` API and lifecycle-safe correlation. |
| `src/ipc/module-service-channels.ts` | Add typed service/main/renderer settings messages. |
| `src/main/module-service-handshake.ts` | Route settings messages from the current service generation. |
| `src/main/module-service-supervisor.ts` | Derive identity from service record, route to renderer, fan out matching changes, and clean up. |
| `src/main/module-service-record.ts` | Add per-record tracking only if needed for pending settings operations/subscriptions. |
| `src/main/mcp/renderer-bridge.ts` | Optionally factor out window-selection/readiness behavior for reuse without changing MCP behavior or routing service settings through MCP. |
| `src/ipc/board-service-settings-channels.ts` | Define narrowly typed main-to-renderer settings requests/replies and renderer-to-main change events. |
| `src/renderer/api/board-service-settings.ts` | Handle only main IPC requests, validate roots, initialize the store, and call shared settings bridge functions. |
| `src/renderer/api/app.ts` | Initialize the dedicated settings IPC adapter before restoring pages. |
| `src/preload.ts`, `src/renderer/types/window.d.ts` | Type the dedicated settings IPC channel names for renderer listeners and replies. |
| `src/renderer/api/board-settings/board-settings-bridge.ts` | Reuse `getBoardSetting()` and `subscribeBoardSettings()`; expose a small initialization seam only if needed. |
| `src/renderer/api/board-settings/BoardSettingsStore.ts` | Expose an initialization method that awaits the existing lazy `ensureLoaded()` before a subscription is installed. |
| `assets/guides/boards.md` | Document settings access from services and bridge 1.42.0. |
| `assets/board-template/CLAUDE.md` | Add service settings API to the board authoring reference. |
| `assets/guides/whats-new.md` | Add service settings to the existing 5.0.13 / 1.42.0 notes. |
| `doc/architecture/overview.md` | Describe service settings routing, renderer ownership, and lifecycle. |
| `src/shared/board-bridge-version.ts` | **No change:** 1.42.0 is already the unreleased bridge version. |
| `package.json` | **No change:** 5.0.13 is already the upcoming app version. |
| `src/board-shim.ts` | **No change:** the requested API is service-host-side; page behavior stays as-is. |
| `src/renderer/api/mcp-handler.ts` | **No change:** service settings are not dispatched through MCP. |
| `src/renderer/api/mcp/command-registry.ts` | **No change:** service settings must not be externally MCP-reachable. |
| `src/renderer/editors/board/BoardWebview.ts` | **No change:** page RPC behavior remains unchanged. |
| Manifest schema / board registration validation | **No change:** settings declarations and validation already exist. |
| Tests and test harnesses | **No change:** explicitly excluded by task scope. |
