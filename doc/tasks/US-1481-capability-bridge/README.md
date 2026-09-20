# US-1481 - Bridge capability and intent transport

## Goal

Implement the board-side bridge for EPIC-108 wave 2: carry an initial intent into a board frame, add correlated capability dispatch over the host-frame channel, expose `persephone.intent.*` and `persephone.capabilities.*` in the board shim, and make `boards.openBoard(boardRoot, { intent })` preserve the request in memory until the new board frame receives it.

The implementation must satisfy the exact `CapabilityTransport` seam defined by [EPIC-108](../../epics/EPIC-108.md), including dispatch, best-effort cancellation, and page-scoped chain lookup. It must not edit the capability bus, the capability-bus channel definitions, or the board registry/trust work owned by US-1479 and US-1480.

## Background

The reviewed epic is the authoritative plan: [EPIC-108 - Capability bus and in-memory intent channel](../../epics/EPIC-108.md). This task is wave 2 and runs in parallel with US-1480. The epic's D1-D10 decisions are binding, especially:

- D1 keeps capability registration and routing local to the renderer/window; main is not a capability router.
- D3 resolves an already-open handler page in the caller's window first, activating it, and otherwise opens the handler in that same window with the request as the board-init `intent`. A winning headless declaration rejects `no-handler` in this epic.
- D5 uses the closed error codes `no-handler`, `untrusted`, `handler-closed`, `crashed`, `cancelled`, `timeout`, `cycle`, `payload-too-large`, `busy`, and `rejected`. `busy` is raised by the bus before transport dispatch when the winning handler has reached `MAX_OUTSTANDING_INTENTS_PER_HANDLER`.
- D6 keeps the chain and depth page-scoped, with the epic's depth limit.
- D7 uses structured-clone payloads with the epic's 8 MiB cap and does not persist intent payloads or introduce a `DataHandle` in this epic.
- D9 requires all teardown paths to settle pending work rather than leave promises hanging.

There are two board channels, and they are not interchangeable. `src/ipc/board-bridge-channels.ts` defines the board-to-main `MessagePort` protocol (`BoardToMain`/`MainToBoard`) for RPC, calls, fire-and-forget messages, and the runner. The board-to-host-renderer channel is `window.postMessage` with `__persephone:` envelopes handled by `BoardWebview.onMessage`; it already carries `host:content`, shared state, `board:aiVision`, and correlated `board:var`, `board:filePath`, and `board:openContent` requests/replies. Capability dispatch is renderer-to-frame with a correlated frame-to-renderer settlement, so it belongs on this host-frame channel, not on main's `MessagePort`.

The current renderer-to-frame direction is otherwise fire-and-forget. `BoardWebview.requestAiVision()` is the existing correlated renderer-to-frame example: it allocates a request id, records generation/iframe/content-window identity, posts to the board origin, validates the reverse message, times out, and rejects pending work during disposal or trust loss. US-1481 should extend that lifecycle pattern for capability dispatch, adding the new cancel frame and typed settlement rather than routing capability work through the main port.

`BoardPortInitMsg` is declared in `src/ipc/board-bridge-channels.ts` and is constructed by `BoardWebview.transferPort()`. The shim's handshake listener in `src/board-shim.ts` consumes the same message using an inline destructured type. Both representations therefore need the new field:

```ts
// Before
export interface BoardPortInitMsg {
  __persephoneInit: true;
  pageId?: string;
  // ...bridge flags...
}

// After
export interface BoardPortInitMsg {
  __persephoneInit: true;
  pageId?: string;
  intent?: {
    id: string;
    version?: number;
    requestId: string;
    payload: unknown;
  };
  // ...bridge flags...
}
```

The existing board shim already has separate request/reply state for host-frame variables, file paths, and content opening. Its public `persephone` object has established `host.*`, `storage.*`, and `providers.*` namespace patterns, which are the model for the two new namespaces. The shim currently records bridge-history comments through 1.6.0 even though 1.7.0 has shipped; the 1.7.0 and 1.8.0 entries must be added with the version bump.

The current `boards.openBoard` implementation in `src/renderer/api/boards.ts` validates the board folder and opens a pure `persephone-board:` link. The link encoder intentionally keeps per-open data out of the URL. The existing link/open pipeline has transient `ILinkData` fields and a `cleanForStorage()` boundary, but intent is not currently carried through it. The implementation must add intent as ephemeral pipeline data, strip it before persistence, and pass it separately into the transient board model so it is available to `transferPort()` without becoming page state or restore data.

`assets/editor-types/` is a hand-maintained flat copy of `src/renderer/api/types/*.d.ts`. `_imports.txt` already lists both `boards.d.ts` and `io.link-data.d.ts`; the copies must still be updated whenever their source declarations change.

## Implementation Plan

1. **Extend the wire declarations without changing the main-channel role.**

   In `src/ipc/board-bridge-channels.ts`, add the optional four-field `BoardPortInitMsg.intent` object (`id`, optional numeric `version`, `requestId`, and structured-clone `payload`). Add the host-frame message types needed for:

   - renderer-to-frame intent delivery;
   - frame-to-renderer intent settlement with a success value or one of the typed capability error codes;
   - renderer-to-frame best-effort intent cancellation;
   - frame-to-renderer capability list and invoke request/reply traffic used by the shim.

   Keep these messages in the `__persephone:` host-frame union. Do not add capability messages to `BoardToMain`/`MainToBoard`, and do not edit `src/ipc/capability-bus-channels.ts`; that module is owned by US-1479 and is absent in the current checkout. Use its EPIC-108 contract when available rather than creating a second channel contract.

   In `BoardWebview.transferPort()`, build the init object from the board model's transient, one-shot intent and post it with the existing port transfer. Clear the transient after the post is accepted so a restored/reloaded page cannot receive the same intent a second time. The init object should look like:

   ```ts
   // Before
   const init: BoardPortInitMsg = {
     __persephoneInit: true,
     pageId,
     // ...existing flags...
   };

   // After
   const init: BoardPortInitMsg = {
     __persephoneInit: true,
     pageId,
     intent: model.consumeInitialIntent(),
     // ...existing flags...
   };
   ```

   The exact model method may be named to match the existing model conventions, but it must be a transient consume operation; intent must not be added to `BoardEditorState`, `getRestoreData()`, stored link data, or any file-backed page representation.

2. **Carry `boards.openBoard(..., { intent })` through the in-memory open pipeline.**

   Update `src/renderer/api/boards.ts` so `openBoard(boardRoot, options?)` validates the board root as it does today, creates the existing board link, and attaches `options.intent` as ephemeral link metadata. Do not encode the payload into the board URL. Update the public signature and documentation in `src/renderer/api/types/boards.d.ts`, copy the declaration to `assets/editor-types/boards.d.ts`, and update the `openBoard` member signature/help text in `src/renderer/scripting/ai-vision/namespaces/boards.ts`.

   Add the transient intent field to `src/renderer/api/types/io.link-data.d.ts`, copy it to `assets/editor-types/io.link-data.d.ts`, and leave `_imports.txt` unchanged because both files are already imported there. In `src/shared/link-data.ts`, destructure intent at the `cleanForStorage()` boundary so it cannot be persisted. In `src/renderer/content/open-handler.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, and the relevant `src/renderer/api/pages/PageNavigator.ts` path, pass intent as a separate transient open option rather than through `sourceLink`. Assign it to the new one-shot field on `BoardEditorModel`, consuming it from `BoardWebview.transferPort()`.

   This preserves the existing persistence behavior while allowing a newly opened handler board to receive the request. It also keeps the intent out of `BoardEditorState`, restore data, and the link data that `PagesModel.attachPage()` can persist.

3. **Add the correlated host-frame transport to `BoardWebview`.**

   Extend `src/renderer/editors/board/BoardWebview.ts` with a board-frame registration/sender used by the transport implementation and with pending capability/intent records carrying request id, handler page id, generation, iframe identity, content-window identity, timer/deadline, and settlement state.

   Implement the following behavior:

   - On dispatch, post a renderer-to-frame intent request to the validated board origin. On settlement, accept only a matching request from the current iframe/content window and current generation.
   - On cancel, post a cancel frame best-effort. The cancel path must catch all posting/teardown errors and never throw to the caller.
   - Reuse the existing origin, source, trust, generation, iframe, and content-window checks used by `handleMessage()` and `requestAiVision()`; reject malformed, stale, or cross-frame replies.
   - Settle pending dispatches on timeout, frame disposal/replacement, board reload/error, trust loss, and page close. Do not leave pending maps or timers behind, and make every settlement at-most-once.
   - Register the main board frame with the renderer transport when it is usable and unregister it in `onDispose()`/frame replacement. The registration must expose enough identity and send/settle hooks for a transport dispatch without importing the main-channel protocol.

   The existing AI transport is the template for identity and teardown handling, but capability settlement must use the EPIC-108 typed codes. A frame error/reload is `crashed`; disposal or an explicit handler page close is `handler-closed`; trust removal is `untrusted`.

4. **Implement and register the board `CapabilityTransport`.**

   Add a renderer-side implementation in a focused module such as `src/renderer/api/board-capability-transport.ts`. It must implement the exact interface from EPIC-108/US-1479, with no renamed methods or altered shapes:

   ```ts
   interface CapabilityTransport {
     dispatch(
       registration: CapabilityRegistration,
       request: IntentRequest,
     ): Promise<unknown>;
     cancel(
       registration: CapabilityRegistration,
       requestId: string,
     ): void;
     chainForPage(pageId: string | undefined): {
       chain: readonly string[];
       depth: number;
     };
   }
   ```

   Dispatch must implement D3 in this order within the caller's renderer/window:

   1. Find the winning handler board page already open in the caller's window, verify that its registration/root is still trusted and its frame is usable, activate it, and dispatch to that frame.
   2. Otherwise, if the winning declaration is headless, reject `no-handler`.
   3. Otherwise call the existing board-opening path in the caller's window with `boards.openBoard(handlerRoot, { intent })`, registering the pending request before opening so the first frame load cannot race the waiter.

   Use the existing board-page/root lookup (`boardPagesForRoot` and the page/editor model) and page activation facilities; do not route through main or open a second window. Keep the request's chain/depth/deadline in the renderer transport/bus context. Only the four init fields defined above cross in `BoardPortInitMsg`.

   The transport must track page-scoped chain/depth for `chainForPage`, including the initial intent delivered to a handler page and nested `persephone.capabilities.invoke` calls. A page's current chain is that of its most recent unsettled inbound intent; clear it when that intent settles by any route - resolve, reject, cancel, timeout, untrust, or frame disposal - so a page with no unsettled inbound intent reports a zero-length chain and invokes at depth 0. It must enforce the bus-provided request/deadline semantics without duplicating the bus's policy or changing its interface.

   Register the implementation during the existing renderer startup/service initialization, before board pages can dispatch requests, through the registration hook exposed by US-1480's capability bus. Do not edit `src/renderer/api/capability-bus.ts` or `src/renderer/api/capabilities.ts`; this task supplies the implementation consumed by that hook.

5. **Extend the board shim API and handshake.**

   In `src/board-shim.ts`:

   - Add `intent` to the inline handshake-listener type as well as consuming it from the init message. The type must include `id`, optional `version`, `requestId`, and `payload`; updating only `BoardPortInitMsg` would leave the shim's inline cast unable to carry the field.
   - Maintain one active intent context and deliver it once to `persephone.intent.onRequest`. `persephone.intent.get()` returns the current request context or `undefined`; `resolve(value)` and `reject(reason)` settle the current request once. The callback shape follows the roadmap's existing usage (`id`, `payload`, `resolve`, `reject`) and the shared request metadata; do not invent an additional public namespace for cancellation.
   - Handle a renderer-to-frame cancel message by marking the active request cancelled and making subsequent resolve/reject attempts no-ops. The cancellation must be observable through the active intent context/getter used by the board handler, while the frame sends no unsolicited second delivery.
   - Add `persephone.capabilities.list()` and `persephone.capabilities.invoke(...)` using host-frame request/reply messages and the public declaration/result types supplied by US-1479/US-1480. `invoke` must return the board-to-board result shape with `pageId` and `result`, and must surface typed rejection rather than silently hanging.
   - Clear/reject pending host-frame capability calls when the parent bridge is replaced or lost, using the same defensive behavior as the existing `board:var`, `board:filePath`, and `board:openContent` request maps.
   - Add the missing 1.7.0 history comment and a 1.8.0 comment in the existing version log, then expose the bumped version.

   Update `src/renderer/editors/board/board-api.d.ts` so runtime members and declarations match exactly. Add the intent request/context and capability list/invoke declarations beside the existing namespaces; preserve the established `host.*`, `storage.*`, and `providers.*` style.

6. **Complete lifecycle/error settlement.**

   Map every D9 event to an explicit settlement and cleanup path:

   | Event | Event source in this code | Required outcome |
   | --- | --- | --- |
   | Handler board becomes untrusted | `boardTrust.subscribePaths()` callback in `BoardWebview.onMount()`/transport registration | Settle the dispatched request as `untrusted`, unregister the board's capability frame, release the pending initial intent, and do not reopen it. |
   | Handler page is closed | Handler page's `PageModel.dispose()` through the additive disposal subscription owned by US-1480 | Settle as `handler-closed`, remove the pending request, and make later frame replies no-ops. |
   | Handler frame is disposed or replaced | `BoardWebview.onDispose()`, `clearIframe()`, generation change, or iframe load/error path | Settle as `handler-closed` for a normal disposal; use `crashed` for the existing frame-error/reload failure path, then unregister the stale frame. |
   | Caller page is closed | Caller page's `PageModel.dispose()` through the additive disposal subscription owned by US-1480 and consumed by its request context | Settle as `cancelled` and invoke the transport's best-effort `cancel`; never keep a caller-owned waiter alive. |
   | Deadline expires | The bus/transport deadline timer for the request | Settle as `timeout`, send best-effort cancel, and remove the request. |

   Ensure `untrusted`, `handler-closed`, `crashed`, `cancelled`, and `timeout` are all delivered upward using the exact error-code contract. A second frame result, cancel acknowledgement, trust event, or disposal event must not change an already settled promise.

   This depends on US-1480's additive `PageModel` disposal subscription (including unsubscribe); US-1481 consumes that API and does not edit `PageModel.ts` or `PagesModel.ts` or compose `PageModel.onClose`.

7. **Bump and mirror the public contract.**

   Change `src/shared/board-bridge-version.ts` from 1.7.0 to 1.8.0. Keep `assets/editor-types/_imports.txt` consistent with every changed/new `src/renderer/api/types/*.d.ts`; the investigation verified that the two relevant entries already exist, so no import-list addition is expected unless a new public type file is introduced. If a new public declaration file is introduced, add its flat copy and import entry in the same change.

## Concerns

- **Parallel-wave seam:** `src/ipc/capability-bus-channels.ts`, `src/renderer/api/capability-bus.ts`, and the expanded capability API are not all present in this checkout. Implement against the exact `CapabilityTransport`, registration, request, and error shapes pinned by EPIC-108 and supplied by US-1479/US-1480. Do not create a competing bus or edit those owned files.
- **Channel confusion:** capability dispatch must never be placed on `BoardToMain`/`MainToBoard`. The main port remains the board-to-main bridge; correlated capability request/reply/cancel traffic is host-frame `window.postMessage` traffic with origin/source/generation validation.
- **Initial-intent race and persistence:** register the pending request before opening a handler page; carry intent through transient link/open options; strip it at `cleanForStorage()`; assign it to the board model before page/frame startup; consume it once in `transferPort()`. Putting intent in `sourceLink`, `BoardEditorState`, restore data, or a URL would violate D7 and could redeliver or persist the payload.
- **Existing-page versus newly opened page:** an existing handler page must win only if it belongs to the caller's renderer, remains trusted, and has a usable frame. A stale page/frame must settle or be skipped according to the D5 code rather than leave the request pending.
- **Cancellation API shape:** the requested shim surface is exactly `intent.get`, `intent.onRequest`, `intent.resolve`, and `intent.reject`. Do not add an unpinned `onCancel` method. The cancel frame updates the active request context and the transport/bus owns the outward `cancelled` settlement.
- **Teardown ownership:** the transport, `BoardWebview`, page close hooks, and the US-1480 bus must agree on one pending-request owner and at-most-once settlement. In particular, caller close must be wired into the bus request context even though the handler frame is in the same renderer.
- **Frame identity/security:** validate every reverse message against the registered board origin, `event.source`, current iframe/content window, and generation. A late result from a replaced frame must not settle a new request with a reused id.
- **Payloads and binary values:** pass structured-clone values directly so `Uint8Array` results survive. Apply the epic's payload cap at the transport/bus boundary and return `payload-too-large` or `rejected` according to the shared contract; do not serialize through JSON or write temporary user-data files.
- **Most likely overrun:** the epic identifies this task as the wave's highest overrun risk. The existing AI vision request/reply code reduces the protocol risk, but cancel frames, typed failures, initial-intent handoff, cross-page lookup, and all D9 teardown paths are new and should be implemented as one lifecycle rather than added as independent fire-and-forget messages.

Files explicitly out of scope and not to be edited: `src/ipc/capability-bus-channels.ts`, `src/renderer/api/capability-bus.ts`, `src/renderer/api/capabilities.ts`, `src/renderer/editors/board/board-manifest.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, and board-info/trust-dialog files owned by US-1479. Do not add unit tests or test harnesses; verification is by the project's existing build, typecheck, lint, and the EPIC-108 live MCP/demo checks.

## Acceptance Criteria

- `BoardPortInitMsg` and `BoardWebview.transferPort()` carry an optional `{ id, version?, requestId, payload }` intent, and the shim's inline handshake type consumes the same field.
- Capability request, settlement, and cancel messages use the `__persephone:` host-frame channel. No capability dispatch or correlated settlement is added to the board-to-main `MessagePort` protocol.
- Renderer-to-frame dispatch and frame-to-renderer settlement validate origin, source, iframe identity, and generation; stale or malformed replies cannot settle a current request; cancellation is best-effort and never throws.
- The board shim exposes `persephone.intent.get`, `onRequest`, `resolve`, and `reject`, plus `persephone.capabilities.list` and `invoke`, with declarations in `src/renderer/editors/board/board-api.d.ts` matching runtime behavior.
- A board intent handler receives structured-clone payloads once, can settle successfully or with a typed rejection, and a capability invocation returns `{ pageId, result }` without routing through main.
- The renderer transport implements the exact EPIC-108 `CapabilityTransport` interface and is registered during renderer startup through the US-1480 bus seam.
- D3 resolution is observable: an already-open trusted handler page in the caller's window is activated and used; otherwise a non-headless handler is opened in that same window with the request as init intent; a headless winner rejects `no-handler`.
- Handler trust removal settles `untrusted`; normal handler page/frame disposal settles `handler-closed`; frame error/reload settles `crashed`; caller close settles `cancelled` and sends best-effort cancel; deadline settles `timeout` and sends best-effort cancel. No path hangs and all settlement is at-most-once.
- Intent metadata is not encoded in the board URL, page state, restore data, persisted link data, or user-data files. `boards.openBoard(boardRoot, { intent })` remains backward compatible when options are omitted.
- `src/shared/board-bridge-version.ts` is 1.8.0 and the shim version history includes 1.7.0 and 1.8.0.
- Changed public declaration files are copied to `assets/editor-types/`, and `_imports.txt` remains complete.
- Existing project build/typecheck/lint and the epic's live verification checks pass. No unit tests, test harnesses, or commit are added by this task.

## Files Changed

| File | Change |
| --- | --- |
| `src/ipc/board-bridge-channels.ts` | Add board-init intent and host-frame intent/capability request/reply/cancel wire declarations. |
| `src/board-shim.ts` | Consume init intent; add `persephone.intent.*`, `persephone.capabilities.*`, host-frame pending/reply/cancel handling, and version-history comments. |
| `src/renderer/editors/board/BoardWebview.ts` | Add correlated host-frame dispatch/settlement/cancel handling, frame registration, and teardown/trust settlement. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Hold and consume one-shot transient initial intent without adding it to persisted state. |
| `src/renderer/editors/board/board-api.d.ts` | Declare the new board shim namespaces and request/result shapes. |
| `src/renderer/api/board-capability-transport.ts` | Implement the exact EPIC-108 `CapabilityTransport` seam and D3 page resolution. |
| `src/renderer/api/boards.ts` | Accept optional intent metadata in `openBoard`. |
| `src/renderer/api/types/boards.d.ts` | Update the public `openBoard` signature. |
| `assets/editor-types/boards.d.ts` | Mirror the public boards declaration. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Update scripting signature/help for `openBoard` options. |
| `src/renderer/api/types/io.link-data.d.ts` | Declare ephemeral intent link metadata. |
| `assets/editor-types/io.link-data.d.ts` | Mirror the link-data declaration. |
| `src/shared/link-data.ts` | Strip intent at the persistence boundary. |
| `src/renderer/content/open-handler.ts` | Pass intent as a transient open/navigation option. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Carry transient intent into a board editor before frame startup. |
| `src/renderer/api/pages/PageNavigator.ts` | Preserve intent through the navigation branch when used. |
| `src/renderer/api/app-service-registry.ts` | Register the board transport during startup through the US-1480 capability-bus seam. |
| `src/shared/board-bridge-version.ts` | Bump bridge version to 1.8.0. |
| `assets/editor-types/_imports.txt` | Verify/update only if a new public declaration file requires an import; existing boards and link-data entries are present. |

No changes: `src/ipc/capability-bus-channels.ts`, `src/renderer/api/capability-bus.ts`, `src/renderer/api/capabilities.ts`, `src/renderer/editors/board/board-manifest.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, and board-info/trust-dialog files.



