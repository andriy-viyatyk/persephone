# US-1562: Board provider status — service `status(config, emit)`, `ProxyProvider` subscription, bridge bump; torrent board adopts it

**Epic:** [EPIC-116: Pipe status and instant open](../../epics/EPIC-116.md)  
**Status:** Done  
**Scope:** Add transient live status from service-backed board providers through `ProxyProvider`, then adopt it in the Torrent Viewer board on `develop`.

## Goal

Let service-backed board providers report bounded, live resource status through the existing provider stage contract. Make the Torrent Viewer report metadata connection, peer count, download speed, and the requested file's progress/completion, with no stale active status after service or port loss.

## Background

### Existing Persephone contract and ownership pattern

US-1560 has added optional `IProvider.status?: IPipeStageStatus` and `onStatusChange(callback): () => void` to the script-facing provider type ([`src/renderer/api/types/io.provider.d.ts:20-27,36-51`](../../../src/renderer/api/types/io.provider.d.ts)). The status state union is `idle | connecting | active | done | error`; optional values are short `text`, `detail`, byte `progress`, and byte-per-second `rate`. The provider descriptor remains the persistence boundary: `ProxyProvider.toDescriptor()` contains only `type` and `config` ([`src/renderer/content/providers/ProxyProvider.ts:238-240`](../../../src/renderer/content/providers/ProxyProvider.ts)).

`ProxyProvider.watch()` is the renderer ownership pattern to mirror: it creates a subscription id, calls `moduleService.subscribeProvider`, stores the returned disposer, and makes the public disposer idempotent ([`src/renderer/content/providers/ProxyProvider.ts:221-234`]); provider disposal drains all retained disposers ([`src/renderer/content/providers/ProxyProvider.ts:236-245`]). Status must be lazy: establish one service subscription when the first `onStatusChange` listener arrives, keep it while at least one listener remains, and dispose it when the last listener leaves or the provider is disposed. The `status` getter returns the latest copied status snapshot; it is initially `undefined` and is cleared (with observer notification) if the service lease is lost.

### Service transport and compatibility

The public board guide says service providers register with `persephone.providers.register(type, implementation)` and implement `readBinary(config)` plus optional `readRange`, `stat`, and `watch(config, onChange)`; `watch` returns a disposer ([`assets/guides/agents/boards.md:391-404`](../../../assets/guides/agents/boards.md)). The module service host validates provider operations, dispatches reads, and owns lease subscriptions in `assets/module-service-host.mjs:144-179,228-319`. It registers provider implementations without a `status` member check today (`assets/module-service-host.mjs:116-137`). The host sends its supported operation classes in the startup `init` configuration assembled by `src/main/module-service-supervisor.ts:474-488`; the operation union/policy and wire message/result types live in `src/ipc/module-service-channels.ts:112-180`. The renderer's lease client in `src/renderer/api/module-service.ts:35-58,131-220,243-275,365-446` handles provider events, replays watch intents after reconnection, and rejects pending work/clears capability caches on lease loss.

There is no separate module-service protocol version constant or a board manifest field that checks one. Service operations are capability-listed by the host init configuration, while board compatibility is checked against the board bridge: `BOARD_BRIDGE_VERSION` is the contract version exposed in the frame (`src/shared/board-bridge-version.ts:1-2`, `src/board-shim.ts:1524`), and `custom-editor-registry.ts:495-498` rejects boards whose `minBridgeVersion` is newer. Therefore bump **`BOARD_BRIDGE_VERSION` only**, from `1.25.0` to `1.26.0`, and make the adopting board require `minBridgeVersion: "1.26.0"`. No service protocol version bump is applicable.

### Torrent Viewer producer

The external repository is `C:/projects/persephone-boards`, currently on `develop`; its root `CLAUDE.md` says board changes and version bumps belong on `develop`, the board manifest is the version source of truth, and each release requires a matching `WHATS-NEW.md` heading (`CLAUDE.md:14-18,39-54,88-101`). The relevant service is `boards/torrent-viewer/scripts/service.mjs`.

The board's existing provider resolves a torrent link to the requested `file` in `torrentFileForLink()` (`scripts/service.mjs:216-243`), reads requested ranges via `file.createReadStream({ start, end })` in `readFileBytes()` (`:347-375`), and buffers the requested whole file in `readTorrentBinary()` (`:618-638`). `registerProvider()` currently registers `stat`, `readRange`, and `readBinary` for `torrent/viewer` (`:640-650`). The service already has the needed source metrics: `torrentStatus()` exposes finite `numPeers` as `peers`, finite `downloadSpeed`, and per-file verified bytes from `file.downloaded` (`:781-814`); `fileProgressOf()` returns an index-aligned array of those per-file counts (`:785-790`). `file.length` is validated and is also returned as provider stat size (`:585-595`). Status must not call `torrentFileForLink()` or `resolveTorrent()`: `findTorrentByInfoHash()` performs a lookup in the existing `torrentsByInfoHash` map without creating a client or adding a torrent (`:18,74-93`). A `readBinary()` or `stat()` may already have caused that torrent to be added; status observes it only after it appears in this map.

The board currently declares version `1.7.2`, `minAppVersion: "5.0.4"`, and `minBridgeVersion: "1.22.0"` in `boards/torrent-viewer/board-manifest.json:7-9`; its `WHATS-NEW.md` latest heading is `1.7.2` (`:1-6`). Updating an existing board leaves `minAppVersion` unchanged unless adopting an app feature that requires a newer app (root `CLAUDE.md:174-178`). Plan the board release as `1.7.3`, set `minBridgeVersion` to `1.26.0`, and retain `minAppVersion: "5.0.4"`.

## Implementation Plan

1. **Add service status subscription operations and bounded wire data.** Update `src/ipc/module-service-channels.ts` with `statusSubscribe` and `statusUnsubscribe` provider operations, typed acknowledgements, and a separate `ProviderStatusEvent` shaped as `{ kind: "provider-status-event"; subscriptionId: string; status: ProviderWireStatus | null }`. Define the wire status shape with the US-1560 fields; `null` explicitly clears status. Extend `PROVIDER_OPERATION_POLICY` with both operations as `control` requests. `src/main/module-service-supervisor.ts` builds `providerRequestClasses` from that map (`:474-488`), so it should pick up the operations without a direct change. Preserve the existing read/write/watch wire behavior. The host should accept an optional `implementation.status(config, emit)` and require its synchronous return value to be a disposer when status is implemented. The emitter validates and copies each value against the US-1560 shape: known `state`; `text` at most 120 characters; `detail` at most 512 characters; `progress.loaded`, optional `progress.total`, and `rate` finite and non-negative. Drop malformed values; do not forward provider objects, extra fields, `NaN`, or infinities. Throttle each status subscription in the service host to at most one emission per 250 ms and cancel its timer/flush state when disposed. A no-status provider acknowledges subscription without emitting and stays status-less.

   Before (existing registration checks only the read function and other optional methods):
   ```js
   if (!isRecord(implementation) || typeof implementation.readBinary !== "function") {
       throw new Error(`provider-registration-invalid-implementation:${type}`);
   }
   ```

   After (optional producer is validated and its subscription operation is host-managed):
   ```js
   if (implementation.status !== undefined && typeof implementation.status !== "function") {
       throw new Error(`provider-registration-invalid-implementation:${type}`);
   }
   // status(config, emit) must synchronously return a disposer; host owns it with the renderer lease.
   ```

2. **Connect status to the renderer lease client.** In `assets/module-service-host.mjs`, start `implementation.status(request.config, emit)` on `statusSubscribe`, store its disposer by lease and subscription id, and dispose it on `statusUnsubscribe` and lease teardown. Send only validated, throttled snapshots through the attached renderer port as `ProviderStatusEvent`; send `status: null` when clearing a live subscription. In `src/renderer/api/module-service.ts`, add a `subscribeProviderStatus()` path parallel to `subscribeProvider()`/`replayWatchIntents()` (`:365-446`): keep a caller-owned intent for reconnect and resubscribe it after a new `hello`; ignore events for unacknowledged or disposed subscriptions. On `loseLease()` (`:250-275`), synchronously clear the associated provider status and notify its listeners before a later reconnect, so the previous lease's `active` snapshot cannot survive a restart or port loss. The service disposer is also called from `closeRendererLease()` through its existing `disposeLeaseSubscriptions()` lifecycle (`assets/module-service-host.mjs:89-113`).

3. **Implement the `ProxyProvider` contract lazily.** In `src/renderer/content/providers/ProxyProvider.ts`, add a private status snapshot, status listener set, and one optional service subscription disposer. Implement `status` as a defensive snapshot getter and `onStatusChange(callback)` as an idempotently disposable listener. First listener starts `moduleService.subscribeProviderStatus(boardRoot, requestMessage(...), callback)`; last listener stops it and clears the remote subscription. Put one `copyProviderStatus(value: unknown)` validator in `ProxyProvider.ts` and use it for all incoming values; `src/renderer/api/module-service.ts` routes typed envelopes and lease generations but does not duplicate the status-field validator. This keeps a single renderer-side validator and prevents malformed values from reaching the pipe. Notify on a clear event and reset state on lease loss; ensure callbacks from a previous lease/subscription are ignored. Add the status disposer to `dispose()` and clear listeners/state on provider disposal. Keep watch disposers independently owned and leave `toDescriptor()` unchanged.

   Before:
   ```ts
   watch(callback: (event: string) => void): () => void { /* service subscription */ }
   toDescriptor(): IProviderDescriptor { return { type: this.type, config: this.config }; }
   ```

   After:
   ```ts
   get status(): IPipeStageStatus | undefined;
   onStatusChange(callback: () => void): () => void;
   // status subscription exists only while status listeners exist; descriptor remains unchanged.
   ```

4. **Bump the board bridge version.** Change `src/shared/board-bridge-version.ts` to `"1.26.0"` and add the matching `1.26.0` service-provider-status entry to the version history comments beside the bridge surface in `src/board-shim.ts:1511-1524`. No independent service protocol version exists to bump. The board capability gate compares `minBridgeVersion` to this constant (`src/renderer/editors/board/custom-editor-registry.ts:495-498`).

5. **Adopt observational status in the Torrent Viewer on the boards repo `develop` branch.** In `C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs`, add `status(config, emit)` to the existing `torrent/viewer` registration. Status must never call `getClient()`, `torrentFileForLink()`, `resolveTorrent()`, `client.add()`, or any read operation. Parse the link, then use `findTorrentByInfoHash(infoHash)` (`:85-93`) as a lookup only. If no torrent is in `torrentsByInfoHash`, emit nothing and re-check on a 1000 ms sampling timer; the status remains undefined until an independent `readBinary()` or `stat()` adds it. If found but metadata is not ready, emit `connecting`; once metadata and the requested file are available, sample that file and torrent once per second. Emit `active` only when the sampled status changed, with text containing peer count and download rate, `progress.loaded = min(file.downloaded, file.length)`, `progress.total = file.length`, and `rate = torrent.downloadSpeed`. Emit `done` exactly once when the requested file's downloaded bytes reach its length, then stop sampling. If a discovered torrent or file errors, report `error` with bounded detail. Return an idempotent disposer that clears the sampling timer and any listeners and prevents later emissions. The service host's 250 ms throttle remains in place, though this producer normally emits at most once per second.

   Before:
   ```js
   register.call(globalThis.persephone.providers, "torrent/viewer", {
       stat: statTorrentFile,
       readRange: readTorrentRange,
       readBinary: readTorrentBinary,
   });
   ```

   After:
   ```js
   register.call(globalThis.persephone.providers, "torrent/viewer", {
       stat: statTorrentFile,
       readRange: readTorrentRange,
       readBinary: readTorrentBinary,
       status: statusTorrentFile,
   });
   ```

6. **Update board authoring documentation and release metadata.** The repo has no provider API recipe in `how-to/` or `doc/` (search confirmed); however, `boards/torrent-viewer/README.md:66` documents the provider registration and `boards/torrent-viewer/CLAUDE.md:7,46-47` documents the provider contract/task ownership. Update both to describe the new status member and its observational/no-network semantics. In `C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json`, bump `version` from `1.7.2` to `1.7.3` and `minBridgeVersion` from `1.22.0` to `1.26.0`; leave `minAppVersion` at `5.0.4`. Add a `1.7.3` heading and one terse status-reporting entry to `boards/torrent-viewer/WHATS-NEW.md`, following root `CLAUDE.md:39-54,88-101`. Keep those board changes on `develop`, uncommitted, and out of the Persephone workspace edits.

7. **Verify only status-less and fake/no-network paths autonomously.** Per the board repo root `CLAUDE.md:179-199`, use the running Persephone MCP for a status-less provider regression and a fake/no-network status producer path, checking the pipe status and `ui.log`, plus subscription cleanup and status clearing after service restart/port loss. The board repo has no `range-provider-test` board (the current board folders are listed in root `CLAUDE.md`'s Layout section, `:20-29`), so use a controlled fake producer with no WebTorrent client or network access if an existing fixture does not fit. Do not open the Torrent Viewer on a real link or otherwise add/download a torrent during autonomous verification. The user performs the real Torrent Viewer/swarm verification. Do not add unit tests.

8. **Keep these files out of direct implementation scope.** Do not edit US-1561 badge files or US-1560's provider status type. No direct changes are needed to `src/renderer/content/ContentPipe.ts`, `src/renderer/content/RateMeter.ts`, `src/renderer/api/types/io.provider.d.ts`, `src/renderer/scripting/ai-vision/content-pipe.ts`, `src/renderer/scripting/ai-vision/namespaces/index.ts`, `src/renderer/api/node-fetch.ts`, `C:/projects/persephone-boards/boards-manifest.json`, or any `versions-manifest.json`. `assets/guides/agents/boards.md` must be updated in EPIC-116's epic-close `/userdoc` and `/document` runs: add the optional service `status(config, emit)` contract and its bounded, disposed subscription behavior to “Service-backed content providers.” Completion skills are epic-scoped until EPIC-116 closes. The board repo's provider reference files are updated in step 6.

## Concerns

- **Lease transitions:** clear status immediately when a lease or port is lost, then replay subscriptions after the next successful attach. A final event from an old generation must not restore stale status.
- **Disposer races:** status may be emitted synchronously from `status(config, emit)` before its disposer is returned, and an unsubscribe may race its acknowledgement. Buffer or gate initial emissions safely and dispose any late subscription result; mirror the existing watch intent cleanup semantics.
- **Status must not initiate a swarm connection:** toolbar status subscribers can be created for restored pages before any editor read. Only inspect `torrentsByInfoHash` via `findTorrentByInfoHash()` (`service.mjs:18,85-93`); if absent, emit nothing and retry on the sample timer. Do not call `getClient()` (`:74-83`), `torrentFileForLink()`, `resolveTorrent()`, or `client.add()` from status. This keeps a visible badge from joining a swarm; US-1555's privacy warning makes this boundary important.
- **Metadata observation:** once a separate `readBinary()` or `stat()` has caused the torrent to appear in the existing index, status may observe its metadata readiness and requested file progress. Stop sampling when the provider unsubscribes, the file reaches done, or the service lease closes.
- **Progress meaning:** use the requested file's verified `file.downloaded` byte count and `file.length`, not whole-torrent `torrent.progress`/`torrent.length`; the existing per-file status projection verifies these metrics (`service.mjs:785-814`). Clamp loaded bytes to total and never emit non-finite numbers.
- **Compatibility:** `assets/guides/agents/boards.md:14` currently has a prose bridge version that does not match `BOARD_BRIDGE_VERSION`; do not use that stale prose as compatibility authority. The exported version constant and the board compatibility gate are authoritative. The guide still needs the provider-status documentation assigned to EPIC-116's epic-close skills below.
- **Documentation ownership:** `assets/guides/agents/boards.md` is not already complete for this API; epic-close `/userdoc` and `/document` must add the contract. The boards repo has no matching API article in `how-to/` or `doc/`, but the Torrent Viewer README and board CLAUDE do document provider registration and must be updated with the adoption.
- **Real swarm safety:** autonomous verification never opens a real torrent or joins a public swarm; only the user runs the real Torrent Viewer check.
- No unresolved design choice remains: only the bridge version is bumped; the service operation allowlist is extended as part of the typed protocol, with no separate protocol-version constant.

## Acceptance Criteria

- Service providers can optionally implement `status(config, emit)` and return a disposer; providers without this method continue to register and behave as status-less providers.
- Status values are copied and validated against the `IPipeStageStatus` state/field contract, strings are bounded, numeric fields are finite and non-negative, and service emissions are limited to about four per second per subscription.
- Renderer-side status-field validation is implemented once in `ProxyProvider.ts` and is not duplicated in `module-service.ts`.
- `ProxyProvider.status` and `onStatusChange` follow provider stage semantics; the service subscription starts with the first observer, ends with the last observer or provider disposal, and is replayed on lease reconnection.
- Service restart, port close, and lease loss clear the current status and notify listeners, so no stale `active` status remains visible.
- Status subscription is observational: when a link is absent from `torrentsByInfoHash`, it emits nothing and retries lookup; status never creates a WebTorrent client, adds a torrent, resolves a magnet, or starts a read. It begins reporting only after an independent read/stat has added the torrent.
- Once observed in the index, the torrent provider reports `connecting` while metadata is not ready, then `active` with peer count, download speed, and the requested file's downloaded bytes/length, followed by one `done` emission when the file completes. It samples once per second, emits only changed snapshots, and cleans up timers/listeners on done, unsubscribe, or service lease loss.
- Autonomous integration verification uses only a status-less provider regression and a fake/no-network producer path through the running Persephone MCP; it does not open a real Torrent Viewer link or join a swarm. The user verifies real torrent behavior.
- `assets/guides/agents/boards.md` is updated by EPIC-116's epic-close `/userdoc` and `/document` runs; Torrent Viewer `README.md` and `CLAUDE.md` document the new member.
- `BOARD_BRIDGE_VERSION` is `1.26.0`; the Torrent Viewer is planned for version `1.7.3`, with `minBridgeVersion: "1.26.0"` and unchanged `minAppVersion: "5.0.4"`.
- The task appears as a linked row under EPIC-116 in both `doc/epics/EPIC-116.md` and the Active section of `doc/active-work.md`.
- No unit tests are added, per task direction. This task document does not implement the feature or commit changes.

## Files Changed Summary

| File | Planned change |
|------|---------------|
| `src/ipc/module-service-channels.ts` | Add status subscription operation/message contracts and operation policy entries. |
| `assets/module-service-host.mjs` | Validate optional status producer and payloads; own, throttle, and dispose service subscriptions. |
| `src/main/module-service-supervisor.ts` | **No direct change**; its existing operation-policy projection automatically includes new policy entries. |
| `src/renderer/api/module-service.ts` | Add typed status subscription intents, lease-loss clearing, and reconnect replay. |
| `src/renderer/content/providers/ProxyProvider.ts` | Add lazy `status`/`onStatusChange`, payload validation, and disposer ownership. |
| `src/shared/board-bridge-version.ts` | Bump board bridge contract from `1.25.0` to `1.26.0`. |
| `src/board-shim.ts` | Add the `1.26.0` bridge history comment for service provider status. |
| `C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs` | Observe only already-indexed torrents; emit per-requested-file status once per second only when changed, then one terminal `done`. |
| `C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json` | Plan version `1.7.3` and minimum bridge `1.26.0`; retain app minimum `5.0.4`. |
| `C:/projects/persephone-boards/boards/torrent-viewer/WHATS-NEW.md` | Add the 1.7.3 release note. |
| `C:/projects/persephone-boards/boards/torrent-viewer/README.md`, `CLAUDE.md` | Document provider `status(config, emit)` and its observational behavior. |
| `src/renderer/api/types/io.provider.d.ts`, `src/renderer/content/ContentPipe.ts`, `src/renderer/content/RateMeter.ts` | **No change**; US-1560 provides the status stage contract and aggregation. |
| US-1561 badge implementation files | **No change**; the badge is being implemented separately. |
| `assets/guides/agents/boards.md` | Update “Service-backed content providers” during EPIC-116 epic-close `/userdoc` and `/document` runs; document optional `status(config, emit)`, bounded emissions, and disposer ownership. |
| `C:/projects/persephone-boards/how-to/`, `C:/projects/persephone-boards/doc/` | **No provider API article found**; no update required there. |
| `assets/module-service-host.mjs` protocol version constant / board manifest service protocol field | **No change**; no separate version/check exists. |
| Board catalog manifests (`boards-manifest.json`, `versions-manifest.json`) | **No change**; generated by the board publishing workflow. |
| Tests | **No change**; user explicitly requested no unit tests. |

## Implementation notes

- Board-repository edits and the requested MCP verification could not be completed: writes outside `C:\projects\persephone` are blocked by the workspace sandbox, and the board MCP stopped responding after its initial overview call.

### Smoke-check fix (Claude)

- **A status subscription no longer starts a board service.** `subscribeProviderStatus` sent
  `statusSubscribe` through `request()`, which acquires a lease, so the badge on a restored
  torrent page would have launched the board's service at app start. It now sends the request
  only when the lease is already attached. Otherwise the intent waits, and `replayWatchIntents`
  sends it once a read attaches the lease. Both paths share one disposer.
