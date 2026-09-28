# US-1544: One provider-operation policy table (deadline, cap)

Epic: [EPIC-115](../../epics/EPIC-115.md) - Phase 2, contracts with one definition.

## Goal

Define each module-service provider operation's deadline and control-request cap class once, then make the renderer client and service host follow that policy. Keep `readBinary`, `readRange`, and `stat` unbounded; `writeBinary` and `watch*` retain the 10-second deadline (`src/ipc/module-service-channels.ts:13`; `assets/module-service-host.mjs:226-230`).

## Background

The epic's standing rules require a `BOARD_BRIDGE_VERSION` bump if a board-visible result shape, new `persephone.*` member, or service protocol changes, require changed message paths to be invoked twice live, and require cross-repo protocol changes to include the torrent viewer and range-provider fixture (EPIC-115, "Standing rules for every story": lines 33-44). US-1544 identifies four copies of deadline policy, a shipped `stat` deadline drift, racing renderer/host timers, and three stale/dead declaration details (EPIC-115, "US-1544": lines 443-463).

The current provider wire operation union is `readBinary`, `readRange`, `writeBinary`, `stat`, `watchSubscribe`, and `watchUnsubscribe` (`src/ipc/module-service-channels.ts:83-99`). The renderer identifies only `readBinary`/`readRange` as content reads (`src/renderer/api/module-service.ts:302-306`), while the host separately identifies those as content reads and adds `stat` to its unbounded set (`assets/module-service-host.mjs:226-237`). This is the drift the policy should remove.

### Verified policy and caps

| Operation | Deadline | Request class / cap classification | Evidence |
|---|---:|---|---|
| `readBinary` | Unbounded | `content-read`: exempt from the 32 control-request slots. | `assets/module-service-host.mjs:227-234,269-279`; `src/renderer/api/module-service.ts:22-24,319-328` |
| `readRange` | Unbounded | `content-read`: exempt from the 32 control-request slots. | `assets/module-service-host.mjs:227-234,281-299`; `src/renderer/api/module-service.ts:319-328` |
| `stat` | Unbounded | `control`: remains subject to the 32-slot cap. Its optional result fields are validated. | `assets/module-service-host.mjs:257-263,309-319,402-405`; `src/renderer/api/module-service.ts:319-328` |
| `writeBinary` | 10 seconds | `control`: subject to the 32-slot cap. | `assets/module-service-host.mjs:301-307,381-415`; `src/renderer/content/providers/ProxyProvider.ts:154-169` |
| `watchSubscribe` | 10 seconds | `control`: subject to the 32-slot cap. | `assets/module-service-host.mjs:336-356,381-415`; `src/ipc/module-service-channels.ts:126` |
| `watchUnsubscribe` | 10 seconds | `control`: subject to the 32-slot cap. | `assets/module-service-host.mjs:322-334,381-415`; `src/ipc/module-service-channels.ts:126` |

The table's `cap` is the request-class mapping that decides whether an operation consumes one of the 32 shared control-request slots: `readBinary`/`readRange` are exempt, while `stat` remains charged (`src/ipc/module-service-channels.ts:12`; `src/renderer/api/module-service.ts:319-328`; `assets/module-service-host.mjs:381-405`). The 256 MiB and 1 MiB byte/range ceilings stay in `src/shared/board-pipe-constants.ts`, with existing numeric mirrors in the plain `.mjs` host (`src/shared/board-pipe-constants.ts:1-5`; `assets/module-service-host.mjs:14-19`). Those byte ceilings are out of scope for the table: do not import the shared constants into `src/ipc/module-service-channels.ts` or add byte-limit fields to `PROVIDER_OPERATION_POLICY`.

### Deadline owner

The renderer should own the single provider-operation deadline timer. Provider requests travel over a transferred renderer/host `MessagePort` after `acquire()` (`src/renderer/api/module-service.ts:329-343,367-374`), while the main supervisor's deadline-wrapped `request()` is used by the separate board service request IPC path (`src/ipc/main/board-handlers.ts:127-132`; `src/main/module-service-supervisor.ts:272-307`; `src/renderer/api/boards.ts:412-422`). Therefore the main supervisor cannot settle a provider-port request without rerouting that traffic. The renderer timer starts before `acquire()` and covers acquisition plus execution (`src/renderer/api/module-service.ts:339-343,367-374`); the host's current provider timer starts only after request receipt (`assets/module-service-host.mjs:407-415`). This makes the single deadline end-to-end from the caller's view, which is the more accurate bound. The renderer can reject its pending promise if the service host hangs and send the existing `cancel` message; the host already deletes the matching pending record, clears its timer, decrements active-read bookkeeping, and aborts a cooperative implementation on cancel (`src/renderer/api/module-service.ts:344-354`; `assets/module-service-host.mjs:468-476`).

The current renderer applies a timeout to every non-`Infinity` request (`src/renderer/api/module-service.ts:330-343`), and the host has `withDeadline()` around `writeBinary()` plus an outer request timer for bounded operations (`assets/module-service-host.mjs:214-224,301-307,393-415`). Remove `withDeadline()`, `UNBOUNDED_OPERATIONS`, `isUnboundedOperation()`, the outer per-request timer, and the long US-1521 comment block above it; replace that block with one short comment stating the renderer owns provider-operation deadlines. Keep `CONTENT_READ_OPERATIONS` as the host's request-class mirror with a pointer comment to `src/ipc/module-service-channels.ts`. Preserve `deadlineMs` in argv because storage and renderer-port-attach timers still use it (`assets/module-service-host.mjs:4-9,53-68,448`); acquisition and main-to-service timers are separate (`src/renderer/api/module-service.ts:281-299`; `src/main/module-service-supervisor.ts:293-307`).

`stat` currently passes `Infinity` from `ProxyProvider` and is in the host's unbounded set but not its content-read set, preserving the capped control slot (`src/renderer/content/providers/ProxyProvider.ts:225-226`; `assets/module-service-host.mjs:228-230,402-405`). Its unbounded deadline and `control` request class must be explicit and independent in the new table.

`unavailableError()` attaches a non-enumerable `serviceCode` property, and no code reads that property; the value is only constructed from `errMessage()` before the error is returned (`src/renderer/content/providers/ProxyProvider.ts:39-47`; repository search found no other `serviceCode` references). `providerDeclaration()` creates `type`, `boardRoot`, `trusted`, and `source`, but omits `boardName`, which is optional on `ProviderDeclaration` (`src/renderer/content/providers/ProxyProvider.ts:30-37`; `src/renderer/content/registry.ts:32-38`). The registry already stores actual declarations with `boardName` for trusted providers (`src/renderer/editors/board/custom-editor-registry.ts:381-387`) and has a private lookup for them (`src/renderer/content/registry.ts:285-287`). Export that lookup and use the actual declaration in `unavailableError()`; this removes the locally fabricated partial declaration while retaining board context in `ProviderUnavailableError` (`src/renderer/content/registry.ts:335-345`).

The `ProxyProvider.readBinary()` comment says only `readBinary`/`readRange` are unbounded and that all other operations keep 10 seconds; both claims conflict with `stat` (`src/renderer/content/providers/ProxyProvider.ts:138-141,225-226`). Replace it with a reference to policy lookup or remove it.

`BOARD_BRIDGE_VERSION` is currently `1.18.0` (`src/shared/board-bridge-version.ts:1-2`). This story should not bump it: no result shape, `persephone.*` member, or service protocol changes, and the deadline remains 10 seconds for control operations (EPIC-115, "Standing rules for every story": lines 35-41; `src/ipc/module-service-channels.ts:83-127`). The renderer timer starts before `acquire()` and therefore wins the current host/renderer race in practice; it returns `service-timeout` (`src/renderer/api/module-service.ts:339-343,367-374`), while the host's later timer can occasionally return `provider-failed` / "Provider operation timed out." (`assets/module-service-host.mjs:407-415`). The only board-visible difference is that a control operation can no longer occasionally fail with the host's `provider-failed` instead of the renderer's `service-timeout`; the canonical renderer error becomes deterministic.

## Implementation Checklist

- [x] 1. In `src/ipc/module-service-channels.ts`, export `PROVIDER_OPERATION_POLICY` keyed by `ProviderOperation`. Each row has only `deadlineMs?: number` and `requestClass: "content-read" | "control"`; use an omitted/undefined deadline for `readBinary`, `readRange`, and `stat`, and `SERVICE_REQUEST_DEADLINE_MS` for write/watch operations. The table's cap classification represents the shared 32-slot control-request cap, not byte ceilings.

   The policy shape keeps deadline and cap class independent, because `stat` is unbounded but capped:

   ```ts
   export interface ProviderOperationPolicy {
       readonly deadlineMs?: number;
       readonly requestClass: "content-read" | "control";
   }

   export const PROVIDER_OPERATION_POLICY = {
       readBinary: { deadlineMs: undefined, requestClass: "content-read" },
       readRange: { deadlineMs: undefined, requestClass: "content-read" },
       writeBinary: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
       stat: { deadlineMs: undefined, requestClass: "control" },
       watchSubscribe: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
       watchUnsubscribe: { deadlineMs: SERVICE_REQUEST_DEADLINE_MS, requestClass: "control" },
   } satisfies Record<ProviderOperation, ProviderOperationPolicy>;
   ```
- [x] 2. In `src/renderer/api/module-service.ts`, type `request()` as accepting `ProviderRequest`, then look up `PROVIDER_OPERATION_POLICY[message.operation]` directly for deadline and request class. Repository search confirms `ProxyProvider.ts:119` is the only `moduleService.request()` caller. The exported `moduleService` object is inferred from that function and has no separate `.d.ts` declaration (`src/renderer/api/module-service.ts:497-505`), so changing the function signature updates its API type. Generic `requestModuleService(boardRoot, message: unknown)` and public `boards.requestService(..., message: unknown)` are the separate main-to-service route and remain unchanged (`src/ipc/api-types.ts:323`; `src/renderer/api/types/boards.d.ts:216`; `src/ipc/main/board-handlers.ts:127-132`). Remove the caller-supplied `deadlineMs` parameter and local `isContentReadOperation()` duplication. Continue enforcing the global 32-slot cap, with `stat` charged as a control request.

   Before (`ProxyProvider.ts:112-123,138-141,225-226`; `src/renderer/api/module-service.ts:308-313`):

   ```ts
   request(operation, extras, deadlineMs, signal)
   moduleService.request(boardRoot, requestMessage(operation, extras), deadlineMs, signal)
   this.request("stat", {}, Infinity, options?.signal)
   ```

   After (typed `ProviderRequest`, policy lookup in `module-service.request`; call sites pass no deadline):

   ```ts
   request(operation, extras, signal)
   moduleService.request(boardRoot, requestMessage(operation, extras), signal)
   this.request("stat", {}, options?.signal)
   ```
- [x] 3. Factor a renderer helper that drops a pending request, clears its timer, removes its abort listener, and posts `{ kind: "cancel", requestId }` only when the client port is attached. Use it for both abort and timeout; each path then rejects with its own code. The timeout callback returns if the request was already dropped, otherwise rejects with `service-timeout` and notifies the host. Store the abort-listener cleanup with the pending request so the helper can remove it (`src/renderer/api/module-service.ts:18-25,339-365`). If acquisition is still pending, remove the request and reject without notifying the host; the later `acquire().then()` already bails when the request is no longer in `client.pending` (`src/renderer/api/module-service.ts:367-374`).

   In `assets/module-service-host.mjs`, always create an `AbortController` for every provider request, regardless of request class, and abort it in the existing cancel branch (`assets/module-service-host.mjs:406-421,468-475`). `executeProviderRequest()` currently passes the signal to `readBinary`, `readRange`, and `stat`, but not `writeBinary` or `watch` (`assets/module-service-host.mjs:269-317,301-307,336-348`). Their current service signatures have no signal parameter (`src/renderer/editors/board/board-api.d.ts:321-334`). Keep those signatures unchanged in this story: cancellation deletes the `writeBinary`/`watch` pending entry, aborts its controller, and suppresses a late reply (`assets/module-service-host.mjs:359-365,468-475`), but those implementations do not receive the signal and may continue async work or side effects; watch registration itself is synchronous. `watchUnsubscribe` invokes a synchronous disposer that also cannot be interrupted once executing (`assets/module-service-host.mjs:322-334,468-475`). Keep the host mirror to `CONTENT_READ_OPERATIONS` plus a pointer comment to `PROVIDER_OPERATION_POLICY`; US-1543 later passes the table in `init` (EPIC-115, "US-1543": lines 427-437; "US-1544": lines 459-463).
- [x] 4. Keep existing byte validation where it is. The 256 MiB and 1 MiB limits remain in `src/shared/board-pipe-constants.ts` and the host's numeric mirrors; do not move them into the policy table (`src/shared/board-pipe-constants.ts:1-5`; `assets/module-service-host.mjs:14-19,194-205,269-299`).
- [x] 5. Remove the stale `ProxyProvider` comment, remove the unread `unavailableError.serviceCode` and its now-unused `errMessage` import, and delete the local `providerDeclaration()` helper. Export the existing `providerDeclarationFor(type)` lookup from `src/renderer/content/registry.ts` and have `ProxyProvider` pass that real declaration to `ProviderUnavailableError`; trusted declarations already carry `boardName` (`src/renderer/editors/board/custom-editor-registry.ts:381-387`). Drop the now-unneeded `boardRoot` argument from the local error helper:

   ```ts
   function unavailableError(type: string, error: unknown): ProviderUnavailableError {
       const unavailable = new ProviderUnavailableError(type, providerDeclarationFor(type));
       unavailable.cause = error;
       return unavailable;
   }
   ```
- [x] 6. Do not change `src/shared/board-bridge-version.ts`; verify the bridge-visible result/error contract remains stable. No cross-repo service protocol change is planned in US-1544, so no board repository migration is required for the implementation itself.
- [x] 7. Live content-read verification with `persephone-boards/_test/range-provider-test`: use its `delay` and `stall=1` provider URL controls (`persephone-boards/_test/range-provider-test/scripts/service.mjs:23-28,119-135`; `persephone-boards/_test/range-provider-test/app.js:36-51`). Confirm stalled `stat` and the following `readRange` path remain pending beyond 10 seconds, then close the page and confirm cancellation frees the request; use `delay=30000` to confirm the stat and ranged content read complete after their delays without a deadline. Verify control-operation timeout with the user's scratch board; do not modify `persephone-boards` for this story. Re-run changed content-read paths on an already-open page as well as a fresh page, twice each, following the epic's live-path rule (EPIC-115, "Standing rules for every story": lines 39-41).

## Live verification (2026-09-28, cold-started dev app, driven over MCP)

Scratch board `US1534Demo` (trusted, `demo/mem` on `mem:`) was given a `writeBinary` that never
answers for a URL containing `hang`, and `stat`/`readRange` that never answer for a URL containing
`stall` (scratch only, not in either repo).

- **Control op times out once:** `pipe.writeText()` on an open `mem://x/hang-b.txt` page rejected at
  10007 ms and 10008 ms (two calls, same page) with `ProviderUnavailableError` whose message now names
  the board ("from board \"US1534Demo\""); the old fabricated declaration had no `boardName`.
- **Host frees the slot on the renderer's cancel:** two back-to-back batches of 32 concurrent hanging
  `writeBinary` calls each ran the full ~10 s (10013 / 10011 ms) instead of the second batch failing
  instantly with host `service-busy`; a `stat` right after answered in 0 ms.
- **Content ops stay unbounded:** a stalled `stat` and a stalled ranged read were both still pending
  at 15 s, and both released at abort (15012 / 15015 ms, two runs).
- **Range Provider Test fixture:** `rangetest://x/a.rangefix?size=4096&delay=12000` `stat` completed
  at 12113 / 12011 ms and a 64-byte ranged read at 12012 / 12004 ms (two runs), i.e. past the old 10 s.

Not verified live: `watchSubscribe`/`watchUnsubscribe` timing (no fixture has a hanging watch; they
share the `writeBinary` control path in `module-service.request`). Page-close release was exercised
through the equivalent abort signal, not by closing a page.

## Concerns

- `stat` is unbounded by deadline but counts against the control-request cap; keep these policies as separate fields so future edits do not accidentally exempt metadata requests (`assets/module-service-host.mjs:228-230,402-405`).
- A renderer-owned timeout settles the caller and deletes the host pending entry, but `writeBinary` and `watch` do not receive the aborted signal under their current service signatures; their underlying work can continue and late replies are suppressed (`assets/module-service-host.mjs:301-307,336-356,359-365,468-475`; `src/renderer/editors/board/board-api.d.ts:321-334`).
- The renderer timer starts before acquisition while the host timer starts on receipt, so the renderer already wins in practice; removing the host timer makes the same 10-second `service-timeout` result deterministic (`src/renderer/api/module-service.ts:339-343,367-374`; `assets/module-service-host.mjs:407-415`).

## Acceptance Criteria

- [x] `PROVIDER_OPERATION_POLICY` in `src/ipc/module-service-channels.ts` is the typed source for all six provider operations' deadlines and applicable cap classification.
- [x] The renderer derives deadlines from the operation and has exactly one provider control deadline timer; timeout cancels/cleans the host request.
- [x] The host mirrors only the `requestClass` mapping in `CONTENT_READ_OPERATIONS` with a pointer comment; `UNBOUNDED_OPERATIONS`, `isUnboundedOperation()`, `withDeadline()`, the outer provider request timer, and the long US-1521 comment are removed. The startup `deadlineMs` argument remains for storage and attach timers.
- [x] The renderer timeout helper deletes pending state, clears timer/listener, and sends cancel only for an attached port; both abort and timeout use it. The host always creates and aborts a per-request controller.
- [x] `readBinary`, `readRange`, and `stat` stay unbounded; only `readBinary`/`readRange` bypass the shared 32-slot control cap; all existing 256 MiB and 1 MiB payload/range caps remain.
- [x] Stale `ProxyProvider` comment, unread `serviceCode`, and fabricated incomplete declaration are removed.
- [x] `BOARD_BRIDGE_VERSION` remains unchanged: there is no result shape, member, or service protocol change; the sole board-visible difference is deterministic `service-timeout` where the current timer race can occasionally return `provider-failed`.
- [x] Live verification uses the range fixture only for content-read delay/stall behavior and uses the user's scratch board for the control timeout; no `persephone-boards` files change in this story.
- [x] No unit tests are added.

## Files Changed

| File | Planned change |
|---|---|
| `src/ipc/module-service-channels.ts` | Add the provider operation policy table and policy types. |
| `src/renderer/api/module-service.ts` | Read policy by operation; own the one deadline timer and cancel on timeout. |
| `assets/module-service-host.mjs` | Mirror the table with pointer comment; remove duplicate provider timers; preserve cancel cleanup and caps. |
| `src/renderer/content/providers/ProxyProvider.ts` | Remove caller deadline arguments, stale comment, unused `serviceCode`, and local fabricated declaration; use the registry lookup. |
| `src/shared/board-bridge-version.ts` | No change; protocol and board-visible shapes remain stable. |
| `src/main/module-service-supervisor.ts` | No provider timer ownership change; its deadline wraps the separate `persephone.service.request` route. |
| `src/main/board-bridge.ts` | No change; remains on the existing main-to-service request deadline. |
| `src/renderer/content/registry.ts` | Export the existing provider declaration lookup for ProxyProvider. |
| `src/shared/board-pipe-constants.ts` | No change; existing shared byte ceilings remain authoritative. |
| `doc/active-work.md` | Link US-1544 to this task document. |
| `doc/epics/EPIC-115.md` | Link US-1544 to this task document and mark it In progress. |
