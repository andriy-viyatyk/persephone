# US-1610: A board can read its own hosted document without `fileSystem`

Epic: [EPIC-119: Board permissions](../../epics/EPIC-119.md)

## Goal

Allow a board's `readFile()` call to read the one file currently hosted by that board frame, even when its `fileSystem` permission is `false`. Keep all other file reads subject to the existing authorization, and never extend the exception to writes or dialogs.

## Background

EPIC-119 defines the user-opened hosted document as always available, while `fileSystem` controls other paths. `BOARD_PERMISSION_INTRODUCTION` in `src/renderer/editors/board/board-permission-copy.ts` promises that a board without permissions can “work with the document you open in it.” Today that promise does not hold for simple boards.

Source verification:

- `src/renderer/editors/board/BoardEditorModel.ts::currentFilePath()` returns `state.filePath ?? state.sourceLink?.filePath`. `BoardWebview.transferPort()` in `src/renderer/editors/board/BoardWebview.ts` reads that source identity and sends it in the private host-to-frame `BoardPortInitMsg.filePath` field. For a plain local path, `src/board-shim.ts::getFilePath()` returns it after handshake. If `materialize` is set, the shim instead asks the host through `board:filePath`; `BoardWebview.resolveFilePath()` calls `model.ensureContentPath()` and replies with the resulting local cache path. Therefore a non-local/archive source path in `BoardPortInitMsg` is not the hosted path to authorize.
- A simple board reads the disclosed path by calling `persephone.readFile(path)`. `boardRpcHandlers.readFile` in `src/main/board-bridge.ts` gets the permission snapshot using the main-owned `entry.root`, then calls `resolveAuthorizedPath()` in `src/main/board-file-access.ts`. That helper rejects immediately when effective `fileSystem` is `false`, before resolving the candidate. It also refuses paths outside the board root or recorded dialog picks under `"board"`.
- `writeFile`, the three native dialogs, and read access all use distinct RPC handlers. The new exception belongs only in the read handler; writes and dialogs must continue to use their existing permission checks.
- `src/main/board-pipe-service.ts` already stores owner metadata (`webContents`, board host/root, file path, and `hostedDocument`) for stream resources. Its `hostedDocument` flag exempts a stream read from path authorization. That registry is keyed by pipe resource/page ids, however, and does not represent each simple board frame's `readFile` target. Do not infer this exemption from a board-supplied RPC path, source URL, or a generic page/resource registration.
- `BoardWebview` creates a unique `boardId` per mounted frame. `src/main/board-bridge.ts::createBoardPort()` creates the matching main-owned `BoardPortEntry` keyed by that id, with the owning `WebContents`, board root/host, and model owner id. `requestBoardPort` arrives through the guarded app-renderer IPC route in `src/ipc/main/board-handlers.ts`; the board page itself has no renderer IPC surface. This per-port entry is the natural place to store the active hosted path.
- The frame's `load` handler in `BoardWebview.handleLoad()` requests a fresh port, including after reload/navigation. Main's `disposeBoardPort()` retires the corresponding entry. `BoardWebview.onDispose()` and permission refresh also dispose the port. Main should clear the path when replacing or disposing an entry so a stale value cannot outlive its frame. A registration route must use `guardIpcSender` via `bindEndpoint` and verify that `event.sender` matches the live port's `hostWebContents` before changing its path.
- `BoardEditorModel.currentFilePath()` is shared by the main and secondary views of the same board. Each `BoardWebview` has a distinct board id and port, so each view can register the same currently hosted file independently. A secondary view must not overwrite the main frame's registration.
- **Hosted path changes while mounted (verified):** for a simple board, `BoardEditorModel.skipSave = true` (`BoardEditorModel.ts`) and it has no Save As/write-through model lifecycle that changes `filePath`. `initFromBoardRoot()` assigns `state.filePath` when a board model is constructed; the file-switch path in `src/renderer/editors/base/editor-switch.ts` rebuilds a simple board over the new file instead of retargeting its mounted frame. The relevant ordinary source identity is also set while constructing/restoring the editor, not changed by a live simple-board save. Therefore `currentFilePath()` does not currently change while a simple-board frame stays mounted. Do not add a state subscription for this task; if a future lifecycle adds in-place path changes, it must update or clear that same frame's main entry before the new path is used.
- `getFilePath()` is a local readable path. For `editorSources: "any"`, Persephone materializes remote sources and archive entries into a cache file before exposing that path. `BoardWebview.transferPort()` can register a direct local path before it transfers the port; for a materialized source, `BoardWebview.resolveFilePath()` must register the exact result of `model.ensureContentPath()` before replying to the board's `board:filePath` request. The exemption therefore applies to the exact cache file supplied to the frame; it does not authorize an archive pathname, source URL, another cache item, or the cache directory.
- Path equality must follow `src/main/board-file-access.ts`'s path policy. Existing candidates are resolved with `fs.promises.realpath`; comparisons normalize resolved paths and are case-insensitive on Windows. Canonicalize both the requested path and the main-stored hosted path with the same realpath behavior, then require equality. This treats a symlink alias as the same underlying file without allowing a different target.
- The agent guide currently says `fileSystem: false` has no bridge file APIs and that `readFile()` requires `"board"` or `"full"`. Its introductory permission table already promises hosted-document access, so both descriptions need to explicitly distinguish the hosted-file read exception. The guide reports bridge version `1.31.0`; `src/shared/board-bridge-version.ts` is the version source of truth.
- No focused board bridge or board file-access test files exist under `src/`. Record this for implementation planning; do not create or run tests as part of this task-document change.

## Implementation Plan

1. **Create plain-local entries with their hosted path atomically.** Extend the existing guarded `requestBoardPort` endpoint in `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, and `src/ipc/renderer/api.ts` with a required extra hosted-local-path argument (`string | null`). In `BoardWebview.handleLoad()`, pass `model.currentFilePath()` only when it is a plain local path; pass `null` for a plain board or a source requiring materialization. `board-handlers.ts` forwards this trusted renderer value into `createBoardPort()` in `src/main/board-bridge.ts`, which creates the new `BoardPortEntry` with the path already set. This removes the create-then-register gap for direct local files. The main process must never obtain the exemption path from `readFile` arguments or messages sent over the board's `MessagePort`.

2. **Add a guarded update only for materialized paths and any future path changes.** Add a dedicated typed endpoint/API method in `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, and `src/ipc/renderer/api.ts`; bind it through the standard guarded `bindEndpoint` route. Give each `requestBoardPort` entry a unique token known by the renderer (for example, pass a per-load token with the request and store it on the entry). The update endpoint takes `boardId`, that token, and the new path (or `null` to clear); main applies it only when both the board id and token still identify the current live entry, and the sender matches its `hostWebContents`. In `BoardWebview.resolveFilePath()`, after `model.ensureContentPath()` resolves a materialized local path, update that entry with the exact result before replying with `filePath:result`; verify the same frame/generation is still current before sending the update and reply. Never register a remote URL or archive-entry source path carried in the init message. The task's source review found no current in-place `currentFilePath()` changes for simple boards, so no state subscription is required. If a later path-changing lifecycle is added, use this same conditional endpoint to update or clear its entry. Secondary frames have distinct ids/tokens and update only their own entry.

3. **Keep the entry bound to its port lifecycle.** A new `createBoardPort()` call for the frame's `boardId` replaces and disposes any old entry; `disposeBoardPort()` clears its path and token. On `BoardWebview.onDispose()` and permission-driven iframe replacement, dispose that frame's entry. The per-entry token prevents a delayed materialization update from applying to a newer port even if the same `boardId` was reused. Plain-local paths need no follow-up registration or separate generation check because they are installed atomically with the new entry. A page opened for another file gets a new frame/port registration from its own model; the prior board id cannot retain or reuse the former path. Do not let one secondary frame clear or overwrite another frame's entry.

4. **Add a read-only exact-file exception in `src/main/board-file-access.ts`.** Add a helper that canonicalizes an existing candidate and the trusted hosted path using the same validation, `fs.promises.realpath`, Windows component normalization, and case-insensitive comparison rules already used by this module. It should return whether both canonical paths identify the same file. The helper must not accept a board-controlled root or hosted path; callers supply `entry.root` and `entry.hostedFilePath` from main-owned state. A missing or invalid hosted path grants no exception. Preserve the existing path validation (including namespace/device and ADS refusal) for the requested path.

5. **Use the exception only in `boardRpcHandlers.readFile`.** In `src/main/board-bridge.ts`, keep the existing main-owned grant lookup and `fileSystem` path. For a read, first accept the request only if it canonically equals the current entry's hosted path; otherwise call existing `resolveAuthorizedPath()` exactly as today. Then read the returned canonical path with the existing encoding behavior. Do not change `writeFile`, `openFileDialog`, `saveFileDialog`, or `openFolderDialog`; none may consult the hosted path. Reuse the normal `boardPermissionError("fileSystem")` refusal for every non-hosted read denied by the current grant.

   Before:
   ```ts
   const filePath = await resolveAuthorizedPath({
       boardRoot: entry.root,
       requestedPath: args[0] as string,
       permissions: grant,
       intent: "read",
   });
   ```

   After:
   ```ts
   const requestedPath = args[0] as string;
   const filePath = await resolveHostedReadOrAuthorizedPath({
       boardRoot: entry.root,
       requestedPath,
       hostedPath: entry.hostedFilePath,
       permissions: grant,
   });
   ```

6. **Update bridge version and agent guide.** Change `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.31.0` to `1.32.0`. Add a `1.32.0` changelog sentence in the version history at the top of `assets/guides/agents/boards.md`. Update the `fileSystem: false` permission-table row to say that the board can read its currently hosted document with `readFile()` while other bridge file APIs and dialogs remain unavailable. Update the `readFile`/`writeFile` description to say `readFile()` may read only the exact current `getFilePath()` target with `fileSystem: false`; other reads and all writes still need `"board"` or `"full"`. Keep user guides out of this task; `/userdoc` is deferred to epic close.

7. **Update epic tracking.** Add the task row under `EPIC-119` in `doc/epics/EPIC-119.md`, immediately after US-1608, and add its linked unchecked dashboard entry in `doc/active-work.md` under EPIC-119, immediately after US-1608.

## Concerns

- The internal registration is an input from trusted host-renderer code. Main must bind it to a live `BoardPortEntry` and the same `hostWebContents`; accepting a path without that entry/sender check would allow cross-board or stale-frame use. The board frame must have no route to this IPC API.
- Avoid a race where a late materialization update for an old frame arrives after a new port was created with the same board id. Require the per-entry token (or equivalent entry identity) to match the current main entry; do not rely on fire-and-forget call ordering across asynchronous IPC. Direct local paths are set atomically by `requestBoardPort` and need no second registration.
- The source review found no current simple-board path change while its frame remains mounted (`skipSave`, constructor-time `initFromBoardRoot`, and dispose-and-rebuild file switching). If implementation finds another path mutation route, add an update/clear call there using the conditional endpoint; otherwise do not add a needless subscription.
- A secondary frame shares the model's current file path but has a distinct board id. Its exemption is valid for that frame's own read calls only. Clearing or replacing one frame's port must not affect another.
- Canonicalization must happen before the `fileSystem: false` early refusal for this one candidate comparison. A string comparison, `path.resolve()` alone, or trusting the path delivered in the board handshake would be insufficient for symlink aliases and case differences.
- Only the exact path exposed by `getFilePath()` is exempt. For `editorSources: "any"`, this is the materialized cache target, not the source URL or archive entry. Do not exempt arbitrary files in the cache folder.
- Content-host and stream-host paths already use their respective host/pipe behavior. This task is for the simple-board `readFile()` gap and must not broaden `board-pipe-service`'s `hostedDocument` boolean into a general path exemption.
- This changes board-visible behavior, so the bridge version bump and guide changelog entry are required. Object-form boards that need the behavior should set `minBridgeVersion` to `1.32.0` under EPIC-119's compatibility decision.

## Acceptance Criteria

- [ ] With `fileSystem: false`, a simple board can read the exact current hosted document path returned by `persephone.getFilePath()`, using supported `readFile()` encodings.
- [ ] With `fileSystem: false`, `readFile()` of any other path is denied with the standard `permission-denied: "fileSystem"` error. With `"board"` and `"full"`, existing read-scope behavior remains intact.
- [ ] The exemption is read-only. `writeFile()` and every native dialog remain denied under `fileSystem: false`, including when their path equals the hosted document.
- [ ] Main derives the hosted path only from the trusted host renderer and binds it to the matching live board port/frame. A board page cannot set it, a different board cannot use it, and a retired frame or page cannot retain it.
- [ ] Main and secondary views of the same board each work independently. Disposing/reloading one view does not unregister or alter another view's hosted path.
- [ ] A frame opened for another file only reads its newly hosted file. A prior path, another cache file, an archive entry, or a source URL does not receive the exemption.
- [ ] Requested and hosted paths are canonicalized with `board-file-access.ts` realpath and Windows case-insensitive comparison rules. Symlink aliases to the exact hosted file resolve as the same file; a symlink to another target does not gain access.
- [ ] `BOARD_BRIDGE_VERSION` is `1.32.0`; `assets/guides/agents/boards.md` has a `1.32.0` changelog line, an accurate `fileSystem: false` row, and an accurate `readFile()` description.
- [ ] `doc/active-work.md` and the EPIC-119 task table link this task after US-1608. User-facing guides are not changed in this task.

### Files requiring no changes in this task

| File | Reason |
|---|---|
| `src/board-shim.ts` | The public `getFilePath()` and `readFile()` APIs already carry the necessary values; authorization belongs in main, and the shim must not decide the exemption. |
| `src/main/board-pipe-service.ts` | Its `hostedDocument` exemption applies to registered stream reads, a separate path from simple-board `readFile()` RPC. Keep this task's exception bound to each board port. |
| `src/renderer/editors/board/BoardEditorModel.ts` | `currentFilePath()` already supplies the host-owned path to `BoardWebview`; no model or persistence change is needed. |
| `src/renderer/editors/board/board-permission-copy.ts` | The trust-dialog promise describes the required behavior; this task implements the promised behavior without changing copy. |
| `src/ipc/board-bridge-channels.ts` | No board-facing RPC method or message shape changes; the new path registration is internal app-renderer IPC. |
| `assets/guides/index.md` and other user guides | User guide review/update is deferred to `/userdoc` at EPIC-119 close. |

## Files Changed

| File | Planned change |
|---|---|
| `src/main/board-bridge.ts` | Store hosted path per live `BoardPortEntry`; expose a sender-checked setter; apply the exact-file exception only to `readFile`; clear state on replacement/disposal. |
| `src/main/board-file-access.ts` | Add canonical equality/hosted-read resolution using the existing path-validation and realpath rules. |
| `src/ipc/api-types.ts` | Declare the internal hosted-path registration endpoint and typed API signature. |
| `src/ipc/main/board-handlers.ts` | Extend guarded `requestBoardPort` with the initial local path and bind the guarded materialized-path update endpoint. |
| `src/ipc/renderer/api.ts` | Extend `requestBoardPort` and add the host-renderer API call for conditional materialized-path updates. |
| `src/renderer/editors/board/BoardWebview.ts` | Pass the local path atomically when requesting a port; conditionally update materialized paths before replying to `getFilePath()`. No path subscription is needed for the current simple-board lifecycle. |
| `src/shared/board-bridge-version.ts` | Bump board bridge version from `1.31.0` to `1.32.0`. |
| `assets/guides/agents/boards.md` | Add the `1.32.0` version note and document the narrow hosted-document `readFile()` exception. |
| `doc/epics/EPIC-119.md` | Add the US-1610 linked task row. |
| `doc/active-work.md` | Add the unchecked US-1610 entry immediately after US-1608. |

## Verification (2026-10-03, live in dev)

The PermTest board was temporarily turned into a simple board for `*.permtest` with all
permissions `false` and `minBridgeVersion: "1.32.0"`. It opened `hostedtest/sample.permtest`:

- `readFile(getFilePath())` succeeded, even though the hosted path was the 8.3 short form
  (`C:/Users/ANDRII~1/...`). Canonicalization matched it.
- `readFile` of a sibling file was denied: `permission-denied: "fileSystem"`.
- `writeFile` of the hosted file was denied: `permission-denied: "fileSystem"`.

Typecheck, lint, and build-prod passed.
