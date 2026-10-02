# US-1608: Deprecation notice for boards without declared permissions

## Goal

Tell users and board-authoring agents when a non-bundled board lacks a declared permissions object, and direct them to add a `permissions` block. Show one batched warning for each open batch, never on reload. Preserve legacy enforcement for now; US-1609 removes the fallback and this notice on 2027-01-03.

## Background

- `src/shared/board-manifest-utils.ts::normalizePermissions` maps absent/non-object values and the historical array form to `{ kind: "legacy", service }`. `boardPermissionAllows` gives legacy boards every flag except `service`, whose value depends on the old array. Notice classification must use normalized `kind === "legacy"`; this includes array-form manifests.
- `src/renderer/editors/board/board-permission-copy.ts::boardPermissionLines` supplies the **Unrestricted** line. `LEGACY_PERMISSION_EXPLANATION` explains current access. Add separate name-based user copy and technical agent-facing copy; do not put “object-form” or “array form” in user-facing warning text.
- `src/renderer/ui/dialogs/TrustBoardDialogView.ts` renders the legacy explanation for first trust. `TrustBoardDialogProps` in `src/renderer/ui/dialogs/TrustBoardDialog.ts` currently has `boardPath` but no display name; pass a name from the normalized manifest, falling back to the root folder name.
- `src/renderer/editors/board-info/BoardInfoEditorView.ts::permissionList` renders the legacy explanation. `BoardInfoEditorModel.loadProperties` supplies the current manifest permission proposal; add bundled-origin state from `bundledBoardRegistry.isBundled(root)` so the warning is omitted for bundled boards.
- The apparent view preflight is not an open-only hook. `BoardHostView.onMount` in `src/renderer/editors/board/BoardEditorView.ts` calls `preflightWebview()`, which calls `requestBoardTrust`. The parent `BoardEditorView.syncBranch` includes `reloadToken` in the branch key, so a reloadToken change disposes/recreates `BoardHostView` and repeats the preflight. `requestBoardTrust` is also used by reload and Board Info / API trust flows, so it must not own the open notice.
- Use `BoardEditorModel.restore()` as the open lifecycle hook. `PagesPersistenceModel.restorePage` invokes it for persisted board models during startup, including each board editor restored from the saved page list. A file opened in a content-host board editor uses `BoardContentEditorModel.restore()`, which calls `super.restore()`; a deferred open calls that through `PageModel.startRestore`. Tab activation only shows/hides the retained `PageSlot` and does not call `restore()`. `reloadToken` changes update the board view branch and do not call `restore()`. Thus restore covers new/opened pages, startup restores, and content-host file opens, while excluding tab activation and reload.
- Before queuing a notice in `BoardEditorModel.restore()`, load trust state and require the board to have already been trusted at open. An untrusted board proceeds to its trust dialog later, which carries the warning; it must not receive a toast after that first trust. Skip bundled roots with `bundledBoardRegistry.isBundled`.
- Batch in renderer module state: collect distinct legacy board roots/names for about one second, then show one warning toast naming them all. Clear the pending batch after display so a later open produces a new notice. No process-wide/session claim or IPC is needed. The `ui.notify(message, type)` API has no action button; the current toast cannot cheaply open the guide.
- `src/renderer/api/boards.ts::enumerateBoardListings` reads manifests for `boards.list()`, which returns to scripts/agents. Add a technical `deprecationNote` only for non-bundled legacy listings. `src/renderer/scripting/ai-vision/namespaces/boards.ts` describes that list; update its member summary/help. Its synchronous child inventory does not read manifests, so do not add disk reads there.
- `assets/guides/agents/boards.md` documents manifest permissions. Add one sentence telling board-authoring agents that missing and historical array-form permissions are deprecated and need an object-form permissions block.
- Bundled/template inventory: `assets/board-template/board-manifest.json` and `assets/demo-board/board-manifest.json` already use object-form flags. The bundled Excalidraw manifest has `permissions: ["capabilities"]`, which `normalizePermissions` treats as legacy; only an exact `"service"` array item affects the legacy service bit. The separate top-level `capabilities` declarations are read by `normalizeBoardManifest` and `custom-editor-registry.ts` to register `image.edit` and `diagram.edit`; they are independent of the permissions array.
- Excalidraw’s library setting `library-path` can point outside the board folder, and `assets/boards/excalidraw/index.html` reads/writes `library.excalidrawlib` at that path (or under user data). `fileSystem: "full"` is required for that configured path and the board’s save operations. The board calls `persephone.settings.get`, `persephone.call` (`fs.commonFolder`, `ui.confirm`, `shell.startScreenSnip`), and `persephone.capabilities.invoke`; these use `appScripting`. The wrapper has no external `content.open` request. The vendored library includes remote service URL constants, but the board CSP in `src/main/board-protocol-service.ts` sets `connect-src 'self'`; verify no reachable remote request is needed and use `network: false`. Proposed minimal grants are therefore `fileSystem: "full"` and `appScripting: true`, with all other flags false. Add `minBridgeVersion: "1.30.0"`.

## Implementation Plan

1. **Add shared, name-aware copy.** In `src/renderer/editors/board/board-permission-copy.ts`, keep `LEGACY_PERMISSION_EXPLANATION` and add separate functions/constants for (a) a single-board user warning, (b) a batched toast listing names, and (c) a technical agent-facing note. User-facing single-board wording should follow: `Excalidraw doesn't declare its permissions. Boards like this are deprecated and will stop working in a future Persephone release. Ask the agent that built it to add a permissions block to board-manifest.json.` Replace `Excalidraw` with the board’s display name. The batch function should list every queued board name and say they do not declare permissions, are deprecated, and need a `permissions` block. The technical agent note may mention missing and historical array-form declarations.

   Before:
   ```ts
   export const LEGACY_PERMISSION_EXPLANATION = "This board uses an older manifest without permission settings, so it can do anything you can: read and write your files, run programs, and use the network.";
   ```
   After: retain that explanation and add distinct name-based user-copy and agent-note exports; do not change `boardPermissionLines()` or enforcement.

2. **Warn in first-trust dialog.** In `src/renderer/ui/dialogs/TrustBoardDialog.ts`, add `boardName` to `TrustBoardDialogProps` and populate it in `showTrustBoardDialog` from the normalized manifest display name, falling back to `fpBasename(boardPath)`. In `src/renderer/editors/board/request-board-trust.ts`, pass that name in both first-trust and permission-change dialog calls. In `TrustBoardDialogView.ts`, show the single-board warning next to `LEGACY_PERMISSION_EXPLANATION` when the disclosed current permissions are legacy. Keep the existing trust/re-trust decisions unchanged.

   Before:
   ```ts
   state.permissions.kind === "legacy" && !state.change
       ? [createTextElement(LEGACY_PERMISSION_EXPLANATION, { color: "light" })]
   ```
   After: render the existing explanation and `legacyBoardDeprecationWarning(state.boardName)` in the same first-trust legacy branch; pass the current board name in dialog state.

3. **Toast on open, never on reload; batch within each renderer.** In `src/renderer/editors/board/BoardEditorModel.ts::restore`, after board identity is revalidated, load/refresh the trust snapshot and inspect the current `manifestPermissions`. Only queue when the root is already trusted, the current manifest normalizes to `kind === "legacy"`, and `bundledBoardRegistry.isBundled(root)` is false. This check happens before the later view preflight can show first trust, so a first-trust dialog is not followed by a toast. Do not put notice code in `requestBoardTrust`, `reloadBoard`, `reloadAndWait`, or `BoardHostView.preflightWebview`.

   Add `src/renderer/editors/board/legacy-board-deprecation-notice.ts` with renderer-local pending roots/names and a roughly one-second timer. Deduplicate repeated restore callbacks for the same editor model/open using its stable editor id, merge distinct names into one `legacyBoardsDeprecationToast(names)`, call `ui.notify(message, "warning")`, then clear the batch. A later open after the flush queues a new toast. This renderer state is intentionally per window; remove the proposed main-process claim set and all corresponding IPC.

   Before:
   ```ts
   async reloadBoard(): Promise<void> {
       const boardRoot = this.state.get().boardRoot;
       if (boardRoot && !(await requestBoardTrust(boardRoot))) return;
   ```
   After: leave reload trust checks as they are; invoke the notice queue from the once-per-open `restore()` lifecycle instead.

4. **Board Info warning and bundled suppression.** In `src/renderer/editors/board-info/BoardInfoEditorModel.ts::loadProperties`, initialize `bundledBoardRegistry` and expose `isBundled` in `BoardPropsInfo`. In `src/renderer/editors/board-info/BoardInfoEditorView.ts::renderProperties` / `permissionList`, show `legacyBoardDeprecationWarning(info.name)` near Unrestricted only when the current `info.proposedPermissions?.kind === "legacy"` and `!info.isBundled`. Use current manifest permissions instead of stale granted permissions.

   Before:
   ```ts
   if (permissions.kind === "legacy") list.append(text(LEGACY_PERMISSION_EXPLANATION, ...));
   ```
   After: retain that line and append the name-aware warning only when the current manifest is legacy and the board is not bundled.

5. **Agent information and guide.** In `src/renderer/api/types/boards.d.ts::BoardListing`, add optional `deprecationNote`. In `src/renderer/api/boards.ts::enumerateBoardListings` / `toBoardListing`, initialize the bundled registry and add the technical note only when the manifest is legacy and the root is not bundled; keep absent optionals omitted. Update the `list` member summary/help in `src/renderer/scripting/ai-vision/namespaces/boards.ts` to tell agents to add an object-form `permissions` block when `deprecationNote` appears. Add one sentence in the permissions section of `assets/guides/agents/boards.md`. Do not edit user guides outside `assets/guides/agents/`.

   Before:
   ```ts
   ...(manifest?.description !== undefined ? { description: manifest.description } : {}),
   trusted: source.trusted,
   ```
   After: add an optional, non-bundled legacy `deprecationNote` between the description and trust fields.

6. **Migrate bundled Excalidraw.** Edit `assets/boards/excalidraw/board-manifest.json`: replace `permissions: ["capabilities"]` with an object whose only enabled values are `fileSystem: "full"` and `appScripting: true`; keep every other permission flag false. Add `minBridgeVersion: "1.30.0"`. Preserve the separate top-level `capabilities` declarations for `image.edit` and `diagram.edit`. The string `"capabilities"` in the old permissions array had no special effect: `normalizePermissions` recognized only `"service"` in old arrays, and capability registration reads the separate `capabilities` property.

   Before:
   ```json
   "permissions": ["capabilities"],
   "capabilities": [
   ```
   After:
   ```json
   "minBridgeVersion": "1.30.0",
   "permissions": {
     "execute": false,
     "service": false,
     "fileSystem": "full",
     "openExternal": false,
     "appScripting": true,
     "network": false,
     "clipboardRead": false,
     "camera": false,
     "microphone": false,
     "geolocation": false,
     "notifications": false
   },
   "capabilities": [
   ```

   Verify the bundled Excalidraw editor still opens `.excalidraw` files and both declared `image.edit` and `diagram.edit` capabilities work. Confirm the library can load and save with the configured `library-path`; verify network-dependent bundle features are not required under the board CSP and `network: false`.

7. **Epic tracking and follow-up.** Extend the 2026-10-03 EPIC-119 Decision line to say `US-1609 (scheduled 2027-01-03) removes the fallback and this notice`. Keep the US-1608 table/dashboard entries. Add a Follow-up line linking to [US-1609](../US-1609-remove-legacy-board-permissions/README.md), which removes the fallback and this notice. Do not bump `BOARD_BRIDGE_VERSION`: these changes alter display, the host `app.boards.list()` result, and one bundled manifest, but not the board-facing bridge API.

## Concerns

- `BoardHostView.preflightWebview()` repeats on `reloadToken` changes; it is explicitly not the toast hook. `BoardEditorModel.restore()` is invoked for persisted boards at startup and for deferred content-host file opens, and is not invoked for tab activation or reload. Use the editor model id to avoid duplicate events if restore is retried or the editor view is reconstructed within that page.
- An inactive persisted tab’s UI view is lazily mounted when it first becomes active, but its model restore runs during startup; queue from model restore so startup-restored legacy boards are batched even before page activation.
- Excalidraw has remote endpoint constants in vendored code, while its active wrapper has no remote `content.open` call and board CSP limits `connect-src` to self. Preserve `network: false` unless a reachable runtime path is found during verification; if one is, document the specific call and scope before enabling internet access.
- The toast has no action button. A guide-opening action is unavailable through the existing notification API.
- This task changes the bundled Excalidraw manifest because its current legacy grant is unrestricted. The proposed file-system grant is full because the user-configurable library directory can be outside the board root.

## Follow-up

[US-1609](../US-1609-remove-legacy-board-permissions/README.md) is scheduled for 2027-01-03 and removes the legacy fallback and this notice.

## Acceptance Criteria

- First trust for any non-bundled legacy board shows the board-name warning beside **Unrestricted**; a successful first trust does not also show a toast.
- Each already-trusted legacy board open queues one notice. All opens within roughly one second produce one warning toast listing their board names. A later open can notify again. Reloads, reloadToken remounts, tab activation, Board Info review, and `app.boards.registerBoard` do not notify.
- Startup-restored board models and file opens in content-host board editors reach the open hook; an inactive restored page can be queued before its first activation.
- Board Info shows the name-aware warning near **Unrestricted** for non-bundled legacy manifests and suppresses it for bundled roots.
- `boards.list()` reports a technical deprecation note only for non-bundled legacy boards; AiVision list guidance and `assets/guides/agents/boards.md` tell agents to add a permissions object.
- `assets/boards/excalidraw/board-manifest.json` uses the stated minimal object-form grants and `minBridgeVersion: "1.30.0"`; `.excalidraw` association and both declared capabilities continue to work. The template and Demo manifests remain object-form. Any other bundled/demo/template legacy manifests are reported.
- No legacy enforcement, service behavior, trust persistence, or re-trust rule changes. No new IPC is added. `BOARD_BRIDGE_VERSION` remains unchanged because the board-facing bridge API is untouched.
- [US-1609](../US-1609-remove-legacy-board-permissions/README.md) is identified as the scheduled follow-up that removes the fallback and this notice.

## Files Not Changed

`src/renderer/editors/board/BoardEditorView.ts` (its nested `BoardHostView.preflightWebview()` repeats on reloadToken remount; the notice belongs to the once-per-open model restore lifecycle); `src/renderer/editors/board/BoardWebview.ts` (frame bridge behavior does not change); `src/renderer/editors/board/board-manifest.ts` and `src/shared/board-manifest-utils.ts` (legacy classification/enforcement remains); `src/renderer/api/board-trust.ts` (existing trust snapshot is sufficient); `src/renderer/api/ui.ts` and `src/renderer/uikit/Notification/NotificationView.ts` (existing warning toast is sufficient and has no action support); `src/shared/board-bridge-version.ts` (no board-facing bridge API change); `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, and `src/ipc/renderer/api.ts` (no claim IPC is needed); `assets/board-template/board-manifest.json` and `assets/demo-board/board-manifest.json` (already object-form and remain unchanged).

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/board/board-permission-copy.ts` | Add separate name-aware user warning/toast functions and technical agent deprecation note. |
| `src/renderer/editors/board/request-board-trust.ts` | Pass the display name to first-trust and permission-change dialog requests; do not trigger the open toast from trust flows. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Queue a warning from the once-per-open restore lifecycle for already-trusted, non-bundled legacy boards. |
| `src/renderer/editors/board/legacy-board-deprecation-notice.ts` | Batch distinct open roots/names for about one second per renderer window and show one persistent warning toast. |
| `src/renderer/api/ui.ts`, `src/renderer/api/types/ui.d.ts`, `assets/editor-types/ui.d.ts` | **General feature, keep in US-1609:** `ui.notify(message, type, { persistent: true })` keeps a toast until the user closes or clicks it. |
| `src/renderer/uikit/Notification/AlertItem.ts`, `AlertItemView.ts`, `AlertsBar.ts` | **General feature, keep in US-1609:** `persistent` alert flag; no auto-close timer; not evicted by the three-alert limit. |
| `src/renderer/ui/dialogs/TrustBoardDialog.ts` | Add board display name to trust-dialog props and state. |
| `src/renderer/ui/dialogs/TrustBoardDialogView.ts` | Show name-aware warning in the legacy first-trust disclosure. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Add bundled-origin status to Board Info properties. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Show name-aware warning near Unrestricted for non-bundled legacy manifests. |
| `src/renderer/api/types/boards.d.ts` | Add optional technical deprecation note to `BoardListing`. |
| `assets/editor-types/boards.d.ts` | Mirror the optional `BoardListing.deprecationNote` declaration for editor and agent tooling. |
| `src/renderer/api/boards.ts` | Add the note to non-bundled legacy `boards.list()` results. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Explain and surface the agent-facing deprecation note. |
| `assets/guides/agents/boards.md` | Add legacy-manifest migration guidance. |
| `assets/boards/excalidraw/board-manifest.json` | Replace legacy array with minimal object permissions and add `minBridgeVersion`. |
| `doc/epics/EPIC-119.md` | Extend decision and link the follow-up task. |
| `doc/active-work.md` | Track US-1608 under EPIC-119. |
