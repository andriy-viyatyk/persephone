# US-2260: SSH board host additions

[EPIC-219: SSH board](../../epics/EPIC-219.md) · Implemented (unreviewed)

## Goal

Let a board refresh its open Explorer trees after a connection setting changes, and let Linux board services reach the user's SSH agent. This enables the SSH board's writable switch and agent authentication.

## Background

- `src/renderer/api/boards/board-tree-page.ts` validates `openTree`, waits for `whenProviderDeclarationsReady`, checks `acceptedBoardTreeProviderForRoot(type, callerRoot)`, and finds a matching Explorer via `page.findExplorer()` and its persisted `state.get().tree`. It creates or focuses a page only for `openTree`. `src/shared/board/board-tree-request.ts` owns JSON and path validation; `src/renderer/content/tree-providers/tree-provider-identity.ts` provides stable, key-order-independent `boardTreeBackingStoreIdentity` (type and config) and `boardTreeSourceIdentity` (also root). Missing config is equivalent to null in these identities.
- The actual `openTree` route is `src/board-shim/bridge-actions-api.ts` → `src/ipc/board-bridge/port-protocol.ts` → `src/main/board-host/rpc/app.ts` → `src/ipc/renderer-rpc.ts` → `src/renderer/api/boards/board-host-rpc.ts` → `board-tree-page.ts`. Main supplies `entry.root`; its existing `openTree` handler also focuses the window, which refresh must not do. `src/ipc/board-bridge/frame-protocol.ts` and `src/renderer/editors/board/frame/board-host-router.ts` serve the separate host-frame request map; `openTree` does not use it. Extend the existing port and renderer RPC method maps, not the frame map or a new transport.
- `ExplorerEditorModel.treeProviderViewModel` exists only while the Explorer view is mounted. Its `TreeProviderViewModel.buildTree()` uses `provider-tree-store.ts` `buildTree()` to call `provider.list(provider.rootPath)`, then publishes the rebuilt tree; it catches listing errors into view state. `ProxyTreeProvider.list()` calls `recordRootReadOnly` on root results, and its `writable` and mutation capabilities consult that flag. A non-mounted Explorer still has a provider; it needs a root list directly, with its eventual mount rebuilding normally. The count denotes pages for which a refresh was run, not successful remote listings; mounted `buildTree` already reports errors in the tree UI.
- `src/main/module-service/process-environment-linux.ts` omits `SSH_AUTH_SOCK` from its allowlist. It is an agent socket path rather than a credential value, and forwarding it lets a service request agent authentication. Windows OpenSSH uses the known `\\.\pipe\openssh-ssh-agent` pipe directly, so its environment allowlist needs no addition.

## Implementation Plan

- [x] **Request and ownership.** In `src/shared/board/board-tree-request.ts`, own a `BoardRefreshTreeRequest` and its validator: same nonblank type and JSON config rules as `isBoardOpenTreeRequest`, with optional `rootPath` checked by `isValidBoardTreePath` when supplied. Reuse `isBoardTreeJsonValue` and factor common validation as needed; preserve `openTree` behavior. In `src/renderer/api/boards/board-tree-page.ts`, own matching and authorization: await `whenProviderDeclarationsReady` and use `acceptedBoardTreeProviderForRoot` with the host-supplied caller root before querying pages. Match `boardTreeBackingStoreIdentity` for type/config and, when supplied, `boardTreeSourceIdentity` for root. Iterate all matching open Explorer pages in each handling renderer; never call navigation, expand a panel, or create a page. Return zero when none match. Reject invalid requests and unowned types as `openTree` does.

  ```ts
  // Before: only open/focus a specific tree
  await persephone.openTree({ type, config, rootPath });
  // After: re-list all matching roots, or only the specified root
  const count = await persephone.refreshTree({ type, config, rootPath });
  ```

- [x] **Reuse the refresh path.** Give a focused Explorer collaborator (for example `src/renderer/editors/explorer/explorer-tree-refresh.ts`) the per-page refresh rule: if mounted, await `treeProviderViewModel.buildTree()`; otherwise await `treeProvider.list(treeProvider.rootPath)` so `ProxyTreeProvider.recordRootReadOnly` runs. Handle an unmounted listing error consistently with Explorer's existing error/recovery behavior and count the attempted page; do not stop refreshing other matches. Preserve existing tree display and expansion behavior through `buildTree`, and ensure later mounting loads current state. No changes to `TreeProviderViewModel.ts` or other roadmap §2.3 god files. Use normal static imports respecting dependency zones; never use `await import()` to dodge an import cycle. If the collaborator needs dependencies, pass the Explorer/provider in rather than creating a reverse dependency.
- [x] **Bridge.** Add the typed request/result to `BoardPortMethods` in `src/ipc/board-bridge/port-protocol.ts` and expose `refreshTree` from `createBridgeActionsApi` in `src/board-shim/bridge-actions-api.ts` through `mainPort.rpc`. Add a handler and `AppDomainKeys` entry in `src/main/board-host/rpc/app.ts`, validate using the shared validator, authorize against the caller renderer first using the existing ownership check, then fan out through a focused main-process collaborator using `openWindows.windows` and `requestRenderer` to each live application renderer, with `entry.root` as `boardRoot`. Sum their counts and return the number without calling `ownerWindow(...).focus()`. Use the existing renderer readiness and lifecycle handling; do not silently omit a live window that cannot be queried: reject on a dispatch failure. Each renderer repeats the ownership check before matching. Add `refreshTree` to `RendererRpcMethods` in `src/ipc/renderer-rpc.ts`; register it in `src/renderer/api/boards/board-host-rpc.ts`, validate the supplied root as in `openTree`, and call the renderer owner above. Reuse the existing typed RPC, lifecycle and error machinery; no new protocol, correlator, error envelope, or frame method map. Update any actual board-facing type declarations discovered at implementation.
- [x] **Linux environment.** In `src/main/module-service/process-environment-linux.ts`, add `SSH_AUTH_SOCK` to `linuxServiceEnvironmentKeys`; the existing environment construction owns copying only allowed inherited values. Leave `src/main/module-service/process-environment-windows.ts` unchanged: the fixed Windows pipe needs no environment variable.

  ```ts
  // Before
  "XDG_RUNTIME_DIR", "TMPDIR", "LANG"
  // After
  "XDG_RUNTIME_DIR", "TMPDIR", "SSH_AUTH_SOCK", "LANG"
  ```

- [x] **Coordinate version and guides with US-2259.** Keep `src/shared/board-bridge-version.ts` at 1.67.0 and extend the existing 1.67.0 entry in `assets/guides/agents/boards/bridge-versions.md` listing service vars, page var delete/keys, and `refreshTree`. US-2259 is committed at 004289f7 with bridge 1.67.0; its existing entry was extended without another bump. At implementation update `assets/guides/agents/boards/services.md` to list `SSH_AUTH_SOCK` in Linux pass-through variables and document refresh matching, ownership, count, and root read-only re-list; coordinate the same guide edits with US-2259. `npm run guides:check` was attempted but is blocked by `spawn EPERM` while esbuild starts. Epic-close `/userdoc` reviews the full guide.
- [x] **One scripted UI test.** Extend `integration-test/fixtures/boards/trees/tree-board/scripts/service.mjs` with a fixture-only `persephone.service.request` operation to toggle a synthetic connection's root `readOnly` flag; retain the existing `ro` behavior. Add one scenario in `integration-test/tests/boards/trees/mutations-and-provider.test.mjs` using its existing board and context-menu helpers: open multiple matching roots plus a different config, flip the fixture root `readOnly` flag via its service operation, invoke `refreshTree` from the board page, and verify a count of two, no active-page change, and that the refreshed tree's context menu loses write items while the different-config tree is unchanged. Also assert that a foreign provider type rejects. Use one application window. Clean up fixture state. This verifies the actual root re-list and menu behavior; no unit tests or UI test for the allowlist. Run `npm run typecheck` and lint. Claude runs the scripted UI test: `refreshTree re-lists matching open trees without changing pages or focus`.

## Concerns

- `buildTree()` catches provider errors and puts them in the Explorer UI. The count is the number of matched pages whose refresh was attempted, including errors, rather than a guarantee of a successful remote operation. Do not turn an unreachable provider into a misleading success guarantee.
- Unlike `openTree`, refresh fans out to every live application window and sums each `PagesModel` count without focusing a window. Windows that close during dispatch can make the request reject; it must not report a complete count while silently skipping a live renderer. The SSH service must independently enforce write permissions immediately even before an Explorer refresh completes.
- US-2259 and this task touch the same version history and services guide. Integrate their final text once; do not overwrite either task's additions.

## Acceptance Criteria

- [x] A trusted caller with the accepted provider can refresh every matching open Explorer root, with optional root filtering, stable deep JSON config matching and a numeric count including zero; invalid and foreign requests reject.
- [x] Refresh neither creates nor focuses a page or window, and works with mounted and unmounted Explorers. A fresh root `readOnly` result changes available write actions; service writes remain independently guarded.
- [x] Linux services inherit `SSH_AUTH_SOCK` when present; Windows requires no new environment key.
- [x] One coordinated bridge 1.67.0 history entry lists both tasks' bridge additions; the services guide describes the new behavior and Linux variable.
- [ ] Claude has run the specified UI scenario; UI execution is delegated to Claude. No unit tests are added.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/board/board-tree-request.ts` | Shared refresh request and validation |
| `src/renderer/api/boards/board-tree-page.ts`, `src/renderer/editors/explorer/explorer-tree-refresh.ts` | Ownership, page matching and existing refresh reuse |
| `src/board-shim/bridge-actions-api.ts`, `src/ipc/board-bridge/port-protocol.ts`, `src/main/board-host/rpc/app.ts`, a focused main-process fan-out collaborator, `src/ipc/renderer-rpc.ts`, `src/renderer/api/boards/board-host-rpc.ts` | Existing RPC method maps and handlers |
| `src/main/module-service/process-environment-linux.ts` | SSH agent socket allowlist |
| `src/shared/board-bridge-version.ts`, `assets/guides/agents/boards/bridge-versions.md`, `assets/guides/agents/boards/services.md` | Coordinated version, history and guide |
| `integration-test/fixtures/boards/trees/tree-board/scripts/service.mjs`, `integration-test/tests/boards/trees/mutations-and-provider.test.mjs` | Fixture toggle and UI scenario |

**No changes:** `src/ipc/board-bridge/frame-protocol.ts`, `src/renderer/editors/board/frame/board-host-router.ts`, `src/renderer/components/tree-provider/TreeProviderViewModel.ts`, `src/renderer/content/tree-providers/ProxyTreeProvider.ts`, `src/main/module-service/process-environment-windows.ts` (reuse their existing behavior).
