# US-2247: Bridge: `openTree` and claimed-scheme links

## Goal

Let a board open or focus an Explorer page for its own accepted tree, and open links in schemes it owns. This is part of [EPIC-217](../../epics/EPIC-217.md); implement after [US-2243](../US-2243-tree-provider-factory/README.md), [US-2244](../US-2244-board-tree-service-api/README.md), US-2245 and US-2246.

## Background

- `src/board-shim.ts` composes `createBridgeActionsApi` from `src/board-shim/bridge-actions-api.ts`; `openRawLink` calls the typed `BoardPortMethods` in `src/ipc/board-bridge/port-protocol.ts`. `src/main/board-host/rpc/app.ts` validates it, supplies the connection's `entry.root` and uses `hostRequest`; `src/ipc/renderer-rpc.ts` types the existing renderer RPC, and `src/renderer/api/boards/board-host-rpc.ts` dispatches into the normal link pipeline. The main connection, not board input, supplies the caller identity.
- Main currently allows absolute paths, `file:`, `http:`, `https:`, `mailto:`, PNG data URLs and hard-coded `torrent:`; `magnet:` is currently rejected by this bridge. Renderer `src/renderer/content/scheme-registry.ts` owns accepted claims (`schemeOf`, `boardSchemeOwner`); main has no equivalent accepted-ownership registry. `BoardRoot.equals` in `src/shared/board/board-root.ts` compares roots safely. A manifest declaration alone is not an accepted claim. The Torrent Viewer is expected to claim both schemes; its manifest is outside this checkout, so verify that assumption live and record the result.
- US-2244 carries `tree: true` and owner declarations in `src/renderer/content/registry.ts`; [US-2245](../US-2245-proxy-tree-provider/README.md) plans an accepted-board-owner query and `sourceUrl = "board-tree:" + stableJson([type, config ?? null, rootPath])`, sorting object keys recursively, preserving array order. Use exactly that implementation for reuse, not a second JSON comparison. US-2246 is being planned in parallel; its document was absent when this plan was written. Assume its Explorer state contains `tree?: { type, config, rootPath }`, alongside the existing local `rootPath`.
- `PageCollectionWrapper.openFolder` validates a local directory with `FileTreeProvider.stat`, then routes its folder navigation URL through `pages.openPath` and folder-editor matching. That is inappropriate for an opaque board path. `PagesLifecycleModel.addEmptyPageWithNavPanel` instead creates a `PageModel`, calls `attachExplorer(page, { rootPath })` in `src/renderer/editors/explorer/page-explorer.ts`, initializes secondary views and adds a sidebar-only page; `attachExplorer` seeds state before restore. This is the simplest consistent layout: an empty main area with the tree in Explorer, not a Category root view. `PageModel.title` currently returns the main editor title or `Empty`, so a board title needs explicit support. Explorer `getRestoreData` already persists its state.
- `src/shared/board/board-permissions.ts` has `appScripting` but no navigation permission; `openRawLink` has no permission on its RPC handler. Follow that rule for both methods; accepted ownership is the restriction, not a new permission flag. Board API authoring documentation is prose, not board IntelliSense declarations: `assets/editor-types/` describes scripting APIs, not `window.persephone`.

## Implementation Plan

- [x] **Typed bridge and validation.** Add a shared JSON-safe tree request type `{ type: string; config?: JSON value; rootPath: string; title?: string }` under `src/shared/board/`, used by `src/ipc/board-bridge/port-protocol.ts` and `src/ipc/renderer-rpc.ts`. In `src/board-shim/bridge-actions-api.ts`, expose `openTree(options): Promise<void>` using `mainPort.rpc("openTree", options)`, as `openRawLink` does; `src/board-shim.ts` already composes that API. Add the method to `BoardPortMethods`, `AppDomainKeys`, and the existing typed handler map. In `src/main/board-host/rpc/app.ts`, validate an object, nonempty string type, JSON-serializable config, canonical board root path using the shared validator below, and optional nonempty string title; reject invalid inputs before forwarding. Put reusable board input rules in `src/shared/board/`; preserve config, paths and title verbatim. Forward via `hostRequest(entry, "openTree", { ...request, boardRoot: entry.root })`, focus the owner window as for `openRawLink`, and use existing typed RPC errors. Never accept a caller-supplied owner. No new permission, transport, envelope, or correlator.

  ```ts
  // Before → after, bridge actions
  openRawLink,
  openRawLink, openTree: (options) => mainPort.rpc("openTree", options),
  ```

- [x] **Board path rule.** Move the existing US-2244 tree path validator from `src/module-service-host/tree-provider-dispatch.ts` to `src/shared/board/board-tree-path.ts`. The shared rule owns absolute, slash-delimited paths, the existing length bound, no NUL, backslash or dot segments, and `/` or no trailing slash. Import it in both the host dispatch and `src/main/board-host/rpc/app.ts`; preserve host validation behavior and reuse the same helper wherever US-2245 needs the rule.

- [x] **Authorization and reuse.** Register `openTree` in `src/renderer/api/boards/board-host-rpc.ts`, delegating to a focused `src/renderer/api/boards/board-tree-page.ts` collaborator. Before looking up or creating a page, wait for provider declarations as US-2245 does and use its accepted-owner query and declaration to require trusted `tree: true` and an accepted owner matching `boardRoot` through `BoardRoot.equals`. Refuse missing, untrusted, non-tree, rejected or another board's type; do not fall back to a proxy shell for this explicit request. Authorize once after `whenProviderDeclarationsReady`, then look up a matching page and, if needed, create and add it in the same tick, with no await between lookup and `addPage`. Avoid logging config. Put board ownership decisions in the existing provider registry or a focused registry helper, not the page or RPC layer.
- [x] Extract/export US-2245's stable source identity helper from `src/renderer/content/tree-providers/` for both `ProxyTreeProvider.sourceUrl` and this collaborator. Compare against each page's Explorer **state descriptor**, including an attached panel on a page with a main editor, even when provider is missing or panel is collapsed; do not rely on an active provider or tab title. Omitted and null config match; types and root paths remain exact, and object-key order does not matter. Focus the first matching page using `pages.navigation.showPage`, expand its Explorer panel, and retain its existing title.
- [x] **Create and title the page.** In `board-tree-page.ts` follow `addEmptyPageWithNavPanel`: create a `PageModel`, synchronously attach an Explorer with the full `tree` descriptor, initialize secondary views, expand Explorer, then call `pages.lifecycle.addPage(null, page)` and `pages.navigation.showPage(page.id)` without awaiting between lookup and add. Refactor `attachExplorer` in `page-explorer.ts` to expose its existing synchronous state creation and attachment separately from its asynchronous `restore()`, while preserving its existing awaited behavior for local callers. Start and await restore after adding the page; handle restore failure through the existing page restore/error mechanism. Dispose the unattached page if synchronous creation fails. Extend `src/renderer/editors/explorer/page-explorer.ts` to seed the descriptor and a display title before restore, preserving local callers. Store title in Explorer state so restore retains it: use the supplied title, otherwise a deterministic non-secret default such as type plus rootPath. Existing page title currently derives only from main editor; move that selection into a small helper in `page-explorer.ts` and replace the single expression in `src/renderer/api/pages/PageModel.ts` with a helper call: use main editor title first, then the Explorer title only for a board-tree sidebar-only page, then existing `Empty`. This keeps local folder titles and pages with a main editor unchanged and does not grow the roadmap §2.3 god file. Confirm the existing descriptor/state subscriptions repaint and persist the title after restore; add only the necessary subscription in the focused collaborator if needed.

  ```ts
  // Before → after, provisioning (conceptual)
  await attachExplorer(page, { rootPath: folderPath });
  const explorer = attachExplorerSync(page, { rootPath: tree.rootPath, tree, title: displayTitle });
  pages.lifecycle.addPage(null, page); // before awaiting explorer.restore()
  // PageModel title expression: mainEditor?.displayTitle ?? "Empty" → pageDisplayTitle(this)
  ```

- [x] **Claimed links.** In `src/main/board-host/rpc/app.ts`, keep existing path/PNG/URL shape validation, file URL conversion, option checks and baseline schemes; accept other syntactically valid absolute URLs for renderer authorization, removing the special `torrent:` allowlist entry. In `src/renderer/api/boards/board-host-rpc.ts`, before any image, browser reuse, in-place or pipeline branch, call a focused rule in `src/renderer/content/scheme-registry.ts`: baseline targets remain allowed; any other URL requires `boardSchemeOwner(schemeOf(target))` to match the connection-supplied `boardRoot` via `BoardRoot.equals`. Preserve the absolute-path and PNG distinctions through the existing typed renderer request if needed (a boolean classification set by main, never board input); do not classify Windows drive paths as schemes. Reject malformed, unclaimed, other-board, script and internal platform schemes before dispatch. Keep `mailto:` and existing ordinary link behavior; do not permit arbitrary `data:`. No second ownership registry or renderer-to-main handshake. `torrent:` and `magnet:` pass only when actually accepted for that caller; collision/untrust immediately revokes access. Use the same existing error path so the promise rejects.

  ```ts
  // Before → after: scheme authorization
  ["file:", "http:", "https:", "mailto:", "torrent:"].includes(parsedUrl.protocol)
  baselineProtocol(parsedUrl.protocol) || acceptedCallerScheme(parsedUrl, entry.root) // renderer gate
  ```

- [x] **Version.** Set `src/shared/board-bridge-version.ts` to `1.65.0` and add the bridge history line. Do not add board-facing IntelliSense typings.
- [ ] **Verification.** `npm run typecheck` and `npm run lint` passed. `npm run guides:check` could not start because esbuild failed to spawn with `EPERM`. `npm run build-prod` was skipped as explicitly forbidden. No unit or integration tests were run. Live checks with the in-progress US-2248 board were unavailable without running its integration tests; no Torrent Viewer manifest is present in this checkout, so its `torrent:` and `magnet:` ownership assumption remains unverified.

## Concerns / Open questions

- No design decision is deferred: the main area is empty, title defaults to type plus root, and an existing page keeps its title. A board's config is opaque persisted JSON; board authors must use connection keys rather than credentials. Do not include config in a title or diagnostic.
- US-2245/US-2246 are prerequisites; reconcile exact exported helper names and state fields with their landed implementations without changing their contracts. Share the identity function and path validation; do not independently reconstruct either. Restore must reuse a page even while its provider is unavailable, after the caller has been authorized.
- Scheme validation must run before every renderer dispatch path, including `reuseKey` and `inPlace`; main still rejects malformed input and controls the caller root. Existing `torrent:` access for boards that did not own it intentionally ends. The actual external Torrent Viewer manifest and both link flows require the live check above.
- Keep board rules in `src/shared/board/` or board registries; use existing typed RPC and frame method maps. No `await import()` or wrapper to evade an import zone, new zone exception, or growth in §2.3 god files. Strict-folder null fixes are type-only unless recorded as explicit behavior changes.

## Acceptance Criteria

- [ ] Authorized `openTree` opens a sidebar-only Explorer page with the supplied descriptor and optional title; state and title survive restore. Only the calling board's accepted `tree: true` type is allowed, without `appScripting`.
- [ ] Matching descriptors focus and expand the existing Explorer, including after restore or while its provider is missing; stable identity prevents duplicate pages on repeated opens.
- [ ] Baseline links still work; only the caller's accepted additional schemes pass. Unclaimed and other-board schemes fail; Torrent Viewer's accepted torrent and magnet links work.
- [ ] Bridge version and history are 1.65.0; required checks and Claude's live results are recorded. No unit tests or new protocol.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/board/` | Shared board request and input validation. |
| `src/shared/board/board-tree-path.ts`, `src/module-service-host/tree-provider-dispatch.ts` | Move the tree path rule into shared board code and reuse it in host dispatch without behavior change. |
| `src/board-shim/bridge-actions-api.ts` | Expose typed `openTree` on the composed bridge. |
| `src/ipc/board-bridge/port-protocol.ts`, `src/ipc/renderer-rpc.ts` | Extend existing method maps. |
| `src/main/board-host/rpc/app.ts` | Validate and forward `openTree`; pass valid additional link schemes for renderer ownership checks. |
| `src/renderer/api/boards/board-host-rpc.ts`, `src/renderer/api/boards/board-tree-page.ts` | Register renderer request; authorize and focus/create tree pages. |
| `src/renderer/content/registry.ts`, `src/renderer/content/scheme-registry.ts`, `src/renderer/content/tree-providers/` | Reuse accepted ownership, add focused scheme rule and share US-2245 identity helper. |
| `src/renderer/editors/explorer/page-explorer.ts`, `src/renderer/editors/explorer/ExplorerEditorModel.ts`, `src/renderer/api/pages/PageModel.ts` | Seed/persist descriptor and title and select sidebar-only title; reconcile with US-2246. |
| `src/shared/board-bridge-version.ts`, `assets/guides/agents/boards/bridge-versions.md` | Version 1.65.0 and history. |

**No changes:** `src/board-shim.ts` already composes actions; `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, local folder routing, `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/shared/board/board-permissions.ts`, `assets/editor-types/`, provider channel and wire primitives. Other guides belong to US-2249.
