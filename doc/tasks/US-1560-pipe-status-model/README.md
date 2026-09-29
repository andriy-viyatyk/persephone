# US-1560: Pipe status model — stage status on providers and transformers, `ContentPipe` aggregation, `HttpProvider` progress, script and agent surface

**Epic:** [EPIC-116: Pipe status and instant open](../../epics/EPIC-116.md)  
**Status:** Done  
**Scope:** Stage status on providers and transformers, `ContentPipe` aggregation, `HttpProvider` progress, and the script/MCP page surface.

## Goal

Add a live status contract to content-pipeline stages and expose the aggregated pipe status to scripts and MCP agents through each page. Report HTTP byte progress and rate for buffered and streamed reads, while keeping status transient and leaving board-provider reporting to US-1562.

## Background

The public interfaces in `src/renderer/api/types/io.provider.d.ts`, `io.transformer.d.ts`, and `io.pipe.d.ts` currently define reads, metadata, serialization, cloning, watching, and disposal, but no status shape or status subscription. The three files are flat-copied by the `editor-types` plugin in `vite.renderer.config.ts` to `assets/editor-types/`, so edits there also become Monaco script IntelliSense types.

`src/renderer/content/ContentPipe.ts` owns the provider and a copied ordered transformer array. Reads run provider first then transformers; `readText()` delegates to `readBinary()`, and `stat()` can also read the pipe if a transformed size is needed. `createReadStream()` delegates directly only when there are no transformers and the provider supports streams; otherwise it buffers through `readBinary()`. This means `HttpProvider` is the source of progress for text/binary reads, no-transform streams, and transformed stream fallback reads.

`cloneWithProvider()` retains the transformer chain by calling each transformer's `clone()` and creates a new `ContentPipe`; `clone()` reconstructs a fresh provider from its descriptor and likewise clones transformers. Neither method currently has subscriptions to copy. `PipePair.setPrimary()` builds a cache clone before swapping, then disposes the old cache and primary; `PipePair.dispose()` disposes both. `ContentPipe.dispose()` currently disposes only its provider. Status subscriptions added by this task therefore need pipe-owned unsubscribe cleanup, must bind independently to each pipe's stage instances, and must not enter `toDescriptor()` or alter provider disposal semantics.

`HttpProvider.readBinary()` currently receives a streamed web `Response` from `nodeFetch` (unless a session URL is used), checks `response.ok`, then calls `response.arrayBuffer()` and caches the resulting `Buffer`. `createReadStream()` obtains a response and pumps `response.body.getReader()` chunks into a Node `PassThrough`. `requestHeaders()` (`HttpProvider.ts:60`) adds a default User-Agent but no `Accept-Encoding` header, so the usual request receives identity-encoded content and its `content-length` describes the bytes consumed. A caller can explicitly supply `Accept-Encoding`, and the session-backed `fetchThroughSession()` path uses Chromium `fetch()`, which may decode the body while preserving a wire-byte length. Keep this task's header interpretation inside `HttpProvider`: use `content-length` only when the request's `Accept-Encoding` is absent or `identity`, and clear `total` as soon as observed loaded bytes exceed it. Do not alter `node-fetch.ts`, `app.fetch()`, or REST Client response-header behavior.

`src/renderer/api/pages/PageModel.ts:218` exposes the raw `mainEditorInstance`; `src/renderer/scripting/api-wrapper/PageWrapper.ts:185` resolves that editor in its private `mainEditor` getter. No-host editors own `EditorModel.pipe` (`src/renderer/editors/base/EditorModel.ts:81`). Text-bearing editors are `TextHostEditorModel` instances with a `contentHost` (`src/renderer/editors/base/TextHostEditorModel.ts:128`) that points to a `TextFileModel`; that host's `pipe` accessor is at `src/renderer/editors/text/TextEditorModel.ts:96`. `TextFileIOModel.setPrimary()` assigns `this.pipes.primary` to the host's `pipe` (`src/renderer/editors/text/TextFileIOModel.ts:81`), while `cachePipe` is a separate member (`src/renderer/editors/text/TextFileIOModel.ts:33`). Thus a page wrapper must read a text host's primary pipe when one exists, then use raw `mainEditor.pipe` for no-host editors; reading raw `EditorModel.pipe` alone can miss the current primary pipe on content-host editors. `PageWrapper` currently exposes page metadata/content/editor but has no pipe member. Its MCP descriptor lists concrete page members in `PAGE_MEMBERS`, and its children are explicitly enumerated in `aiChildren()`. `PageCollectionWrapper` exposes open pages as dynamic `[index]` children; the renderer MCP entry point in `src/renderer/scripting/ai-vision/call.ts` calls `resolveCall()` on `AiRoot`, so the page wrapper descriptor controls reachability. MCP callers address the real path as `pages[0].pipe` or `pages["<page-id>"].pipe`. The task must add both the script type/getter and the page's declared AiVision member/child so the same pipe status shape is reachable through the call resolver.

The epic fixes the stage shape as `state: "idle" | "connecting" | "active" | "done" | "error"`, optional `text`, `detail`, byte `progress`, and bytes-per-second `rate`; pipe stages are provider-first and transformer order, with role/type/display name/status. Summary selection gives errors precedence and otherwise picks the most recently updated stage. Pipe notifications are throttled to about four per second. The stage contract is optional so existing providers and transformers stay status-less. US-1561 consumes the pipe events to render its page badge and stage popover; US-1562 adds board-service status and a `ProxyProvider` subscription; US-1563 consumes that status UI in the loading shell. Keep this API additive and stable for those consumers.

### Verified lifecycle and progress constraints

- `src/renderer/content/PipePair.ts` owns paired primary/cache pipes. Replacing a primary creates the new cache with `primary.cloneWithProvider(new CacheFileProvider(...))` before releasing the previous pair, and `replace()` disposes the old cache and old primary. A cache clone therefore needs its own pipe subscription wiring and should report the cache provider's own status plus cloned transformers.
- Provider `readBinary()` already accepts optional `AbortSignal`; `ContentPipe.readBinary()` forwards it to the provider and every transformer. `ContentPipe.readText()` currently has no options parameter but reaches the same provider path. Stream callers pass a signal into `HttpProvider.createReadStream()`; cancellation remains owned by the stream/read operation.
- `ProxyProvider` currently offers no `status` or `onStatusChange`; its only subscription pattern is `watch()`, which stores returned disposers and releases them from `dispose()`. Do not add board/service status behavior in US-1560; US-1562 owns that bridge and its version bump.
- Put a reusable `RateMeter` in `src/renderer/content/RateMeter.ts`, alongside the producer that needs it. `HttpProvider` should use one provider-level accumulator per activity burst, summing bytes from every concurrent read and measuring aggregate bytes per second. Set `progress.total` only while exactly one full, non-range read is active and its total is known; clear the total for overlapping reads, ranged reads, non-identity `Accept-Encoding`, or loaded bytes that exceed the candidate total. Throttle producer emissions to roughly four per second. `ContentPipe` separately throttles its aggregate `onStatusChange` fan-out at the same cadence, so arbitrary stage implementations cannot flood the UI or MCP observer.

## Implementation Plan

1. **Define the additive contracts in the three script-facing declarations.** In `src/renderer/api/types/io.provider.d.ts`, define/export the shared `IPipeStageStatus` shape (or place it in a small shared declaration and import it consistently) and add optional readonly `status` plus optional `onStatusChange(callback): () => void` to `IProvider`. Add the same optional members to `ITransformer` in `io.transformer.d.ts`. In `io.pipe.d.ts`, add exported stage/role types, readonly `stages`, readonly `summary`, and `onStatusChange(callback): () => void` to `IContentPipe`. Keep descriptors unchanged and document that progress/rate are bytes and bytes per second.

   Before:
   ```ts
   export interface IProvider {
       readonly type: string;
       readBinary(options?: { signal?: AbortSignal }): Promise<Buffer>;
   }
   ```

   After:
   ```ts
   export interface IProvider {
       readonly type: string;
       readonly status?: IPipeStageStatus;
       onStatusChange?(callback: () => void): () => void;
       readBinary(options?: { signal?: AbortSignal }): Promise<Buffer>;
   }
   ```

   Add the parallel pipe shape to `IContentPipe`:
   ```ts
   readonly stages: ReadonlyArray<IPipeStage>;
   readonly summary: IPipeStageStatus | undefined;
   onStatusChange(callback: () => void): () => void;
   ```

   Page script surface:
   ```ts
   export interface IPage {
       readonly pipe?: IContentPipe;
   }
   ```

2. **Implement live aggregation in `src/renderer/content/ContentPipe.ts`.** Enumerate a provider stage followed by transformer stages, retaining references to stage instances and latest-change ordering internally. When subscribed, observe each optional `onStatusChange`; rebuild observation when `addTransformer()` or `removeTransformer()` changes the chain; detach on unsubscribe and `dispose()`. The getter returns current stage snapshots without exposing mutable internal arrays. `summary` selects an error first, otherwise the most recently updated stage with a status, and is `undefined` when no stage currently has a status. Notify pipe subscribers no more than about four times per second and cancel any pending timer when no listeners remain or the pipe is disposed. Never subscribe to or mutate a stage's persisted descriptor.

3. **Add `src/renderer/content/RateMeter.ts` for shared producer-side byte accounting.** Track cumulative loaded bytes for the current activity burst and an elapsed-time rate in bytes per second. `HttpProvider` owns one meter for the burst and adds chunks from all active reads to it. Keep `total` only while exactly one full, non-range read is active and its total is known; clear it for concurrent/ranged activity and once loaded exceeds it. When a new read begins after the active count reached zero, reset the burst accumulator. Sample at 250 ms or less often, and always flush the final snapshot in the next allowed slot so low-volume and terminal reads reach their terminal state without exceeding the throttle. Do not put progress accounting in `node-fetch.ts`, which is shared with `app.fetch()` and REST Client requests.

4. **Report status in `src/renderer/content/providers/HttpProvider.ts`.** Maintain a provider-level status snapshot, subscriber set, active-operation count, and `RateMeter` for the current activity burst. `readBinary()` and full `createReadStream()` requests are full reads; a ranged `createReadStream(range, ...)` is a range. Use the request's `content-length` as `total` only for absent/`identity` `Accept-Encoding` and exactly one active full read. Clear `total` for concurrent or ranged activity, and as soon as accumulated `loaded` exceeds the candidate total (including session-backed Chromium-decoded responses). `readBinary()` should consume `response.body` with a reader so chunks update the shared accumulator, then cache the resulting buffer as it does now. `createReadStream()` adds reader chunks before passing them to `PassThrough`, preserving ranges, abort behavior, and stream error propagation. Status is `active` while any operation is in flight; when the last settles, use `done` for normal completion, `error` if a real failure occurred, and a non-error idle/last-settled status if all remaining work was canceled. The `_cachedBuffer` fast path at `HttpProvider.ts:70` starts no operation and leaves the last settled status unchanged. Treat `AbortError`, an aborted signal, and consumer-side `PassThrough` destruction as cancellation: cancel/release the read without setting stage `error`. Only actual HTTP status failures and network/read failures set `error`. Apply the same classification to buffered and streaming paths. Do not change `src/renderer/api/node-fetch.ts` or serialize status in `toDescriptor()`.

5. **Expose the pipe on the page script surface.** In `src/renderer/api/types/page.d.ts`, add a readonly `pipe?: IContentPipe` (using a type-only import). In `src/renderer/scripting/api-wrapper/PageWrapper.ts`, use its existing private `mainEditor` getter (`src/renderer/scripting/api-wrapper/PageWrapper.ts:185`), which returns `mainEditorInstance`. If the wrapper model is a `TextFileModel`, or the main editor has a `TextFileModel` `contentHost`, return that host's `pipe`; otherwise return `this.mainEditor?.pipe`; return `undefined` when no current pipe exists. The host accessor at `src/renderer/editors/text/TextEditorModel.ts:96` returns `pipeState`, and `TextFileIOModel.setPrimary()` assigns the primary pipe there (`src/renderer/editors/text/TextFileIOModel.ts:81`), not the cache pipe (`cachePipe` is separate at `src/renderer/editors/text/TextFileIOModel.ts:33`). `PageModel.mainEditorInstance` returns the raw editor (`src/renderer/api/pages/PageModel.ts:218`), which for text pages is a `TextHostEditorModel` subclass; `TextHostEditorModel.contentHost` exposes its `TextFileModel` host (`src/renderer/editors/base/TextHostEditorModel.ts:128`). Do not read `this.page?.mainEditor?.pipe` or raw `mainEditor.pipe` alone for text pages. Add `pipe` in `PAGE_MEMBERS` and the page descriptor's declared children as a node. Use the real page node name `pipe`, under `pages[index-or-id]`; do not add a root-level `pipe` namespace (that name is reserved by the AiVision root).

6. **Make `IContentPipe` inspectable in MCP calls.** Add `src/renderer/scripting/ai-vision/content-pipe.ts` with a `describeContentPipe()` descriptor for read-only `stages` and `summary`, and register it in `src/renderer/scripting/ai-vision/namespaces/index.ts` with `registerAiVision(ContentPipe, describeContentPipe)`. The `ai-vision` registry walks an object's prototype chain, so `PageWrapper.pipe` can return the same raw `IContentPipe` that scripts receive. Shape stage/status values as ordinary bounded data rather than provider/transformer instances. Do not expose `onStatusChange` as an MCP-call member: MCP calls create and dispose a fresh `ScriptContext` per request (`src/renderer/scripting/ai-vision/call.ts`), so a persistent event subscription is not an agent read surface. The script interface retains `onStatusChange`. Add the page `pipe` descriptor member and `.pipe` child in `PageWrapper`; verify `pages[index-or-id].pipe` through `PageCollectionWrapper`'s dynamic index. `ai-vision` requires a descriptor for traversable nodes and does not reflect undeclared object members, so returning the raw pipe alone would not make `stages`/`summary` discoverable.

7. **Confirm downstream compatibility.** Keep `src/renderer/content/providers/ProxyProvider.ts` unchanged for status; note that US-1562 can implement the optional provider contract with lazy status subscription following its existing `watch()` disposer ownership. US-1561 can subscribe to `pipe.onStatusChange` and render `summary`/`stages`; US-1563 can reuse the same public pipe surface while a page is loading. Avoid edits to the page badge, provider-service protocol, board bridge version, loading shell, and persisted `IPipeDescriptor` in this task.

## Concerns

- **Status is stage-scoped while reads may overlap.** HTTP media can issue concurrent ranges against one provider. Aggregate all received bytes and their rate at provider level for each activity burst. Ranged or concurrent activity has no single meaningful total; only expose a total during one full read with a known content length, and clear it if loaded bytes exceed it.
- **Observer ownership must follow pipe lifetime.** Avoid permanent provider/transformer subscriptions when nobody listens. On chain mutation, ensure a listener sees the new stage set and no callback from a removed stage; on unsubscribe/dispose, clear stage disposers and queued notification timers. `clone()` and `cloneWithProvider()` must create independent aggregate subscriptions, while cloned transform instances may keep their own initial status values.
- **The script and MCP node need bounded data.** The actual page path is `pages[index-or-id].pipe`; add that node and its member declarations at `PageWrapper`, then expose only status data through the descriptor. This allows US-1561/1563 to consume one consistent shape and US-1562 to add status to board providers later.
- **No unresolved design decisions.** Status fields and summary precedence are fixed by EPIC-116 decisions 1-2. Producer and aggregate notifications are each limited to one update per 250 ms; a terminal status replaces any queued value and is emitted in the next allowed slot. Pipe stage subscriptions are attached only while at least one pipe observer exists.

## Acceptance Criteria

- Providers and transformers may optionally expose a typed, live stage status and a disposable status subscription; existing implementations continue to compile and operate without status.
- `IContentPipe.stages` lists provider then transformers with role, type, display name, and current status. `summary` prefers an error, otherwise identifies the most recently updated stage with a status, and is `undefined` when no stage currently has a status.
- `IContentPipe.onStatusChange` reports stage changes at roughly four notifications per second or less, and all listeners/timers are released on unsubscribe, stage removal, and pipe disposal.
- `HttpProvider.readBinary()`, `readText()` through that path, and direct `createReadStream()` report aggregate provider status and loaded/rate data across concurrent reads. `total` appears only for one full read when known, and is removed for non-identity encoding, ranged/concurrent activity, or once loaded exceeds it. The cached-buffer fast path starts no read and preserves the last settled status.
- Aborted signals, `AbortError`, and consumer-side stream destruction settle as cancellation without setting `error`; only real HTTP, network, and body-read failures set `error`. A completed activity burst reports `done` when its reads settle normally.
- `clone()` and `cloneWithProvider()` return pipes with independent observer lifetimes; `PipePair` replacement/disposal does not retain status subscriptions on disposed pipes.
- Scripts can inspect `page.pipe.stages` and `page.pipe.summary`; MCP can inspect the same data as `pages[0].pipe` and `pages["<id>"].pipe`.
- Status is not serialized by provider, transformer, or pipe descriptors. `ProxyProvider`, board bridge protocol/version, US-1561 badge, and US-1563 loading shell remain for their named follow-on tasks.
- No unit tests are added, per project direction.

## Files Changed Summary

| File | Planned change |
|------|---------------|
| `src/renderer/api/types/io.provider.d.ts` | Shared status type and optional provider status members. |
| `src/renderer/api/types/io.transformer.d.ts` | Optional transformer status members. |
| `src/renderer/api/types/io.pipe.d.ts` | Stage and aggregate status types/surface. |
| `src/renderer/content/ContentPipe.ts` | Stage enumeration, aggregation, throttled notification and subscription cleanup. |
| `src/renderer/content/RateMeter.ts` | New reusable byte progress/rate helper. |
| `src/renderer/content/providers/HttpProvider.ts` | HTTP buffered and stream progress producer. |
| `src/renderer/api/types/page.d.ts` | Script-facing optional pipe member. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Page pipe getter, AiVision member and child. |
| `src/renderer/scripting/ai-vision/content-pipe.ts` | New MCP descriptor for a content pipe's read-only status surface. |
| `src/renderer/scripting/ai-vision/namespaces/index.ts` | Register `ContentPipe` with its MCP descriptor. |
| `src/renderer/content/PipePair.ts` | **No direct change expected**; existing clone/dispose flow must be preserved and verified against new ownership. |
| `src/renderer/api/node-fetch.ts` | **No change**; changing its response headers would affect `app.fetch()` and REST Client callers. |
| `src/renderer/content/providers/ProxyProvider.ts` | **No change in US-1560**; board status subscription belongs to US-1562. |
| `src/renderer/content/transformers/ArchiveTransformer.ts`, `DecryptTransformer.ts` | **No built-in status production required**; optional contract keeps them status-less. |
| `src/renderer/content/registry.ts`, `src/renderer/content/PipePair.ts` | **No descriptor/registry redesign**; preserve the transient status boundary and existing lifecycle. |
| `src/renderer/content/providers/FileProvider.ts`, `CacheFileProvider.ts`, `DataUrlProvider.ts`, `GuideProvider.ts`, `MnemeProvider.ts` | **No change**; status remains optional and these providers keep current behavior. |
| `src/renderer/editors/*`, `src/renderer/ui/*`, board service protocol/version | **No change**; UI consumers and board adoption are follow-on epic tasks. |

## Implementation notes

- Transformer implementations have no `displayName` contract; the stage display name falls back to its type so the planned stage shape remains complete.

### Smoke-check fix (Claude)

- **`nodeFetch` body never settled after an abort.** An abort after the response headers
  destroyed the Node response, which emits neither `end` nor `error`, so a reader waiting on the
  web body stream hung forever. The old `response.arrayBuffer()` path hung the same way; the
  status now stayed `active` forever. `src/renderer/api/node-fetch.ts` now errors the body stream
  with an `AbortError` on abort. This is a fetch-semantics fix only: headers are unchanged.
- **Verified live:**
  - a full read reports `done` with loaded/total and rate;
  - an abort mid-body rejects with `AbortError` in about 4 s and leaves the stage `idle`, not
    `error`;
  - a consumer destroying `createReadStream()` leaves it `idle`;
  - an HTTP 404 gives `error` with detail;
  - MCP `page.pipe` returns `stages` and `summary`.
