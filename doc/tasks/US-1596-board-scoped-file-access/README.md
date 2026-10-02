# US-1596: Scoped file access for boards

Epic: [EPIC-119: Board permissions](../../epics/EPIC-119.md)

## Goal

Enforce the trust-time `fileSystem: false | "board" | "full"` grant across every board-reachable file surface. Confine object-form `board://` assets to their own board root, while preserving the hosted-document exception and historical behavior for legacy manifests.

## Background

EPIC-119 makes the normalized grant set stored in the main-owned trust snapshot authoritative. Main-process and renderer-host gates must use that snapshot, never the live manifest or a permission supplied by the board. A denied promise uses the shared `boardPermissionError("fileSystem")` text: `permission-denied: "fileSystem" is not enabled in board-manifest.json`. Legacy manifests (missing permissions or the old array form) retain today's unrestricted file behavior.

US-1593 inventory rows 5-7, 13, 15-17, 27-28, and 34 cover the relevant surfaces. Source verification confirms:

- `src/main/board-bridge.ts:203-207` currently resolves absolute `readFile`/`writeFile` paths unchanged and relative paths against the board root. `boardRpcHandlers` at `:238-258` opens native dialogs and reads/writes files without a fileSystem gate. Writes create parent directories before writing.
- `src/ipc/main/dialog-handlers.ts:10-84` implements generic open-file, save-file, and open-folder dialogs and remembers the last picked directory. The board bridge calls those helpers at `src/main/board-bridge.ts:238-240`; the board bridge must record the selected paths against its immutable `entry.root` after the dialog returns.
- `src/renderer/editors/board/BoardWebview.ts:1147-1225` resolves `content.open()`. It currently gets a network grant before `model.openContentResource()`, while `BoardEditorModel.openContentResource()` in `src/renderer/editors/board/BoardEditorModel.ts:693-738` creates and stats the provider before publishing the stream resource. Local file-backed sources therefore need a file grant check before provider I/O. `src/renderer/editors/board/board-pipe-handler.ts:132-195` reads the registered pipe, and `src/main/board-protocol-service.ts:207-254` serves its bytes.
- `src/main/board-protocol-service.ts:256-325` serves a board asset using `decodeURIComponent(pathname)` and `path.resolve(root, rel)` (`:283-290`); its source comment at `:27-30` explicitly records that there is no traversal guard. Encoded traversal and symlink/junction targets are not confined today.
- `src/renderer/content/providers/HttpProvider.ts:349-368` sends direct requests to `nodeFetch` with `boardNetworkPolicy`, but its session-backed branch only sends the `session-src://` URL. `src/main/session-src-protocol.ts:33-60, 77-145` stores a handle, target URL, session, and optional Tor partition, but no board identity or grant. The session route therefore needs the main-owned board identity and same network/MCP checks as direct board content.
- `src/main/board-storage.ts:113-137` stores board API JSON under the app data folder in a board-keyed private directory. The board API exposes that scoped store separately through `src/main/board-bridge.ts:269-276`; it does not expose its filesystem path. Direct `fileSystem: "board"` access will not include this private application storage folder. Keeping it excluded preserves the storage API boundary and prevents reads/writes to its metadata and implementation files.
- Inventory row 17, `persephone.icons.forFiles()` (`src/renderer/editors/board/BoardWebview.ts:1130-1145`), resolves icon data from supplied names and does not read the named filesystem paths. Keep that lookup available; do not treat the filenames it receives as file-read authorization.
- `src/board-context-menu.ts:159-175` implements “Save Image As” by calling the board RPC `saveFileDialog`, then `writeFile`; gating those central RPC handlers also covers the context-menu action.
- `src/shared/board-manifest-utils.ts:77-79` exports `boardPermissionError`; current bridge version is `1.29.0` in `src/shared/board-bridge-version.ts`.

The hosted document is a separate user-authorized capability: its path/source disclosure (`BoardWebview.resolveFilePath()` at `:1110-1128`), content stream, and normal read/save lifecycle remain allowed regardless of `fileSystem`. Every other file path must be authorized separately.

### Defined scope semantics

- **`false`:** refuse all board bridge file access, including the open/save/folder dialogs. Dialogs are not a harmless exception: returning a picked path grants the board read access under the selected-path rule. Hosted-document operations and the board's own `board://` assets remain available.
- With `fileSystem: false`, `readFile()` of the board's own bundled files is refused too. Boards should use `fetch("board://<host>/data.json")` or relative `fetch("./data.json")` for their own assets; `board://` root access is always allowed.
- **`"board"`:** allow paths inside the canonical board root and paths explicitly picked in this board's own dialogs during the current app session. An open-file or save-file pick grants that exact selected path; a picked folder grants its subtree. Store picks in main memory keyed by canonical board root, add them only after a successful dialog result, and clear them when the app process exits. A board reload does not clear them. A pick made by another board or by an app dialog grants nothing to this board.
- **Board data/storage folder:** excluded. `board-storage.ts` is app-owned persistent storage exposed through board-scoped `storage.get/set/delete/keys`, not arbitrary board filesystem space. The root and pick rules must not add the app data folder as an implicit allowed path.
- **`"full"`:** allow any ordinary canonical filesystem path, including UNC paths. Device and namespace paths remain refused. Under `"board"`, UNC paths are allowed only when canonicalization proves they lie inside the board root or a picked path/subtree. Never treat device paths as ordinary UNC paths.
- **Self-editing manifest:** `board-manifest.json` is inside the board root, so `"board"` permits writing it. This is not escalation: all enforcement continues to use the stored granted snapshot. When the live manifest differs, the user sees the existing US-1598 re-trust/change flow; only an explicit re-trust replaces the grant.

### Shared Windows-safe path authorization

Add one main-process helper in `src/main/board-file-access.ts` and route every board file decision through it. It receives a trusted board root, the requested path, and the effective grant from main-owned state; callers may supply the board operation's path but never its board identity or grant. It returns a canonical path only after authorization, and also owns the in-memory per-root pick registry.

The helper must:

1. Reject empty/non-string paths and device/namespace prefixes (`\\?\`, `\\.\`, including slash-normalized spellings) before resolution. Reject alternate data streams by disallowing `:` outside the drive designator. Apply Windows trailing-dot/trailing-space normalization to each path component before comparison, so aliases cannot bypass the check.
2. Canonicalize the board root and every candidate using the same native `fs.promises.realpath` function (libuv native, backed on Windows by `GetFinalPathNameByHandleW`); this expands 8.3 names and resolves junctions, symlinks, and subst-like reparse points. Do not use `fs.realpathSync` or non-native `fs.realpath` implementations that walk `lstat`. Using the same function matters because a mapped drive may canonicalize to a UNC path. For an existing write target, realpath the target file itself so a symlink file inside an allowed folder pointing outside is refused. For a not-yet-existing write target, realpath its existing parent. If parent directories are also missing, realpath the nearest existing ancestor and append each normalized missing component. Authorize the resulting parent-plus-name before `mkdir` or `writeFile`; after creating parents, realpath the parent and recheck before the write to catch a changed link target.
3. Compare canonical paths case-insensitively on Windows using a path-segment boundary (not a string prefix), so `C:\board-elsewhere` is outside `C:\board`. `realpath` canonicalization must also collapse 8.3 short names before comparing.
4. For `"board"`, allow only the real board root and the canonical user-picked files/folders for that root. For `"full"`, allow any ordinary resolved path. Reject UNC paths that are not within the effective allowed scope; namespace/device paths are rejected regardless of grant.
5. Expose a root-only authorization mode for `board://`: it always checks the canonical candidate against the board root and never consults `fileSystem` or user-picked paths.

All callers pass only a board root obtained from an immutable main bridge entry, a host-owned board model, or a board protocol host registration. Board arguments may name a candidate path but cannot choose a root, populate the pick set, or provide permission flags. Main IPC used by renderer-host content resolution must verify the root against the main trust snapshot and use the grant stored there.

## Implementation Plan

- [x] Add `src/main/board-file-access.ts` with canonical Windows path resolution, path containment, fileSystem authorization, a root-only mode, and the app-session pick registry. Use `fs.promises.realpath` (libuv native → Windows `GetFinalPathNameByHandleW`) for the board root and every candidate, including existing write target files; for a new write, realpath its existing parent (or nearest existing ancestor when parent directories are missing) before creation and revalidate after creation. Keep the helper as the only implementation of path-based board file authorization.
- [x] In `src/main/board-bridge.ts`, replace the current `resolveBoardFilePath()` behavior at `:203-207` with the shared helper and main-owned `boardTrustService` grant lookup. Gate `readFile` and `writeFile` before filesystem I/O and preserve their existing encoding behavior. For writes, authorize before `mkdir` and recheck the canonical target after creating directories.
- [x] Gate `openFileDialog`, `saveFileDialog`, and `openFolderDialog` in `boardRpcHandlers` at `src/main/board-bridge.ts:238-240`. Under `fileSystem: false`, throw `boardPermissionError("fileSystem")` before showing any dialog. Under `"board"` or `"full"`, show the existing dialog; after success, record selected file paths or folder paths in the main pick registry under `entry.root`. Open/save file picks authorize that exact file (including a not-yet-created save target); folder picks authorize the selected folder and descendants. Cancellation adds no grant. This central handler also covers `src/board-context-menu.ts` “Save Image As”. Leave generic non-board dialog behavior in `src/ipc/main/dialog-handlers.ts` unchanged.
- [x] Add a main-owned authorization IPC route for renderer-host file-backed content in `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, and `src/ipc/renderer/api.ts`. Add `boardTrustService.getGrantedPermissions(boardRoot)` in `src/main/board-trust-service.ts` to return only the trust-snapshot grant for a known root. The IPC handler must verify the supplied host-owned root exists in the main trust snapshot, fetch its stored grant with that method, then call `board-file-access.ts`; renderer code cannot submit a permission set or establish picked paths. Use this route before provider resolution/stat/read and from the board pipe read boundary where the source is not the hosted document.
- [x] In `src/renderer/editors/board/BoardWebview.ts:1147-1225` and `src/renderer/editors/board/BoardEditorModel.ts:693-738`, carry host-owned `boardRoot` to `content.open()` resolution, resolve the content descriptor before I/O, and classify local `FileProvider`/archive-backed sources separately from `HttpProvider`. Require `fileSystem` access for non-hosted local files; keep HTTP(S) under the existing network rule and service-registered providers under their existing `service` grant; reject unsupported file-backed registered providers unless their path can be authorized by the shared helper. The user-opened hosted document remains exempt.
- [x] Carry file-source ownership into `src/renderer/editors/board/board-pipe-handler.ts:132-195` and the main board pipe read service so streamed content resources are checked against the host-owned board identity before reads. The user-opened hosted document is kept on its separate exempt lifecycle; content.open resources do not infer exemption from a board-supplied URL or resource ID.
- [x] In `src/main/board-protocol-service.ts:256-325`, decode and normalize the asset path, then use `board-file-access.ts` root-only mode for every object-form manifest before `net.fetch`. Correctly reject encoded traversal (`%2e%2e%2f`), encoded/backslash separators, symlink/junction escapes, and any target whose canonical path is outside that board root. Confine when either the current manifest is object-form or the stored grant is the object-form `flags` kind, so a board cannot remove confinement by changing its live manifest before re-trust. Legacy grants and manifests retain today's traversal behavior until EPIC-119 migration.
- [x] Bind the board identity/grant to session-backed remote content. Add a host-renderer endpoint in `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, and `src/ipc/renderer/api.ts` that derives a board-bound session-src capability from the existing opaque handle and a root obtained from the host-owned `BoardEditorModel`; validate that root with `boardTrustService.getGrantedPermissions(boardRoot)` in main and bind the stored grant/MCP endpoint to the derived handle. Before each `entry.session.fetch`, apply the same network scope and MCP endpoint refusal used by direct board requests. Inspect and validate every redirect hop before following it. Preserve normal non-board session-src behavior. Session/proxy DNS resolution remains subject to the existing remote-DNS/proxy limitation recorded in the epic.
- [x] Reuse the exact shared refusal from `boardPermissionError("fileSystem")` for denied file RPCs and content operations. Dialog refusals occur before prompting; other denied promises reject with `permission-denied: "fileSystem" is not enabled in board-manifest.json`. Legacy manifests continue to bypass new fileSystem restrictions, as their normalized grant is historical unrestricted access.
- [x] Bump `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.29.0` to `1.30.0` because bridge behavior changes. New object-form manifests must set `minBridgeVersion` to `1.30.0` or newer, per EPIC-119's old-build compatibility decision.

### Before → after contract

```ts
// Before: absolute paths are returned as-is; relative paths are merely joined to root.
function resolveBoardFilePath(root: string, p: string): string {
    return path.isAbsolute(p) ? p : path.resolve(root, p);
}

// After: main resolves and authorizes against its trust snapshot and canonical roots.
const filePath = await boardFileAccess.resolveAuthorizedPath({
    boardRoot: entry.root, // immutable main-owned identity
    requestedPath,
    permissions: await boardTrustService.getGrantedPermissions(entry.root),
    intent: "read", // or "write"; pick recording is a separate main-owned operation
});
```

```ts
// Before: every board can open a native picker and receives the selected path.
openFileDialog: (entry, args) => showOpenFileDialog(ownerWindow(entry.hostWebContents), params),

// After: check the grant before prompting; then bind successful picks to this board root.
openFileDialog: async (entry, args) => {
    const grant = await boardTrustService.getGrantedPermissions(entry.root);
    boardFileAccess.requireDialogPermission(grant);
    const paths = await showOpenFileDialog(ownerWindow(entry.hostWebContents), params);
    if (paths) await boardFileAccess.recordPickedFiles(entry.root, paths, grant);
    return paths;
};
```

## Concerns

- Windows path handling must account for case-insensitive names, path-component boundaries, symlinks/junctions, short 8.3 aliases, trailing-dot/space aliases, ADS, device namespaces, and UNC paths. The main helper is the single policy point; caller-specific string comparisons are prohibited.
- Directory creation can follow a link changed after an initial check. Authorize before creating any directory and canonicalize/recheck after creation immediately before write.
- Hard links inside an allowed folder that point to an outside file cannot be detected by `realpath`; creating one already requires `execute` or `fileSystem: "full"` access.
- Under `"board"`, a board can rewrite its own code files (such as `index.html` and scripts), so a viewer injection can persist in the board; this stays within the granted set, and US-1599 guidance must tell viewer boards to use `fileSystem: false`.
- Renderer-host content handling must keep the hosted document distinguished by main/host model context; do not exempt arbitrary file paths merely because they came through `content.open()` or a pipe.
- A write to the board's own manifest under `"board"` does not replace the grant snapshot. The board remains on its old grant until the user completes US-1598 re-trust.
- No unit tests are part of this task, per project workflow.

## Acceptance Criteria

- [ ] Every file-related entry in the US-1593 inventory is accounted for: bridge reads/writes, all three board dialogs, board-scoped `storage`, filename-only icon lookup, file-backed `content.open()` and pipe reads, hosted-document exceptions, object-form `board://`, and “Save Image As”. Preserve the existing `service` gate for service-registered providers. Any additional file-backed surface discovered during implementation is gated or documented as an explicit exception.
- [ ] `false` refuses all board bridge file methods and dialogs with the exact `fileSystem` permission error; hosted-document operations and the board's own assets continue to work.
- [ ] With `fileSystem: false`, bridge `readFile()` of the board's own files is refused; the task and US-1599 guide state that the board reads those assets with `fetch("board://<host>/data.json")` or `fetch("./data.json")`.
- [ ] `"board"` allows only canonical paths inside the board root or this board's current-session dialog picks; picked file paths are exact, picked folders include descendants; picks are main-owned and persist across reload but not app exit.
- [ ] `"board"` excludes the private `board-storage` data folder. Writing `board-manifest.json` inside the board root is allowed, but cannot change the active grant before US-1598 re-trust.
- [ ] `"full"` allows ordinary filesystem paths. The common helper refuses device/namespace paths and resolves allowed UNC paths only within the effective scope.
- [ ] Path authorization uses the same native `fs.promises.realpath` for the root and every candidate, compares canonical paths case-insensitively on Windows, follows symlinks/junctions, realpaths existing write target files, handles not-yet-existing write targets through their realpathed parent and rechecks after directory creation, and closes traversal, ADS, trailing-dot/space, and 8.3-name bypasses.
- [ ] Every object-form manifest is confined to its own root on `board://` regardless of fileSystem; encoded traversal, backslash traversal, and symlink escapes fail. Legacy manifests retain current protocol behavior.
- [ ] `session-src` board content receives main-owned board identity and uses the same `network: "internet"` local-address and MCP-endpoint decisions as direct remote content; unowned/non-board session-src callers retain existing behavior.
- [ ] `BOARD_BRIDGE_VERSION` is bumped as an explicit implementation step, and new object-form board manifests require the bumped version.
- [ ] No implementation is included in this task-document change.

### Files requiring no changes in this task

| File | Reason |
|---|---|
| `src/ipc/main/dialog-handlers.ts` | Generic dialog implementations are shared by non-board callers; board-specific gating and pick recording belong in the board bridge wrappers. |
| `src/main/board-storage.ts` | Its board-keyed JSON storage remains a separate scoped API; the new fileSystem permission deliberately does not expose its private data folder. |
| `src/renderer/editors/board/board-open-content.ts` | This module only creates an in-memory editor page from caller-supplied text; file-backed path resolution belongs to `content.open()` and pipe handlers. |
| `src/board-context-menu.ts` | The menu already routes “Save Image As” through the board RPC `saveFileDialog` and `writeFile`, so central bridge enforcement covers it without menu changes. |
| `src/shared/board-manifest-utils.ts` | The `fileSystem` union, normalized grant model, and exact `boardPermissionError()` already exist. |
| `src/board-shim.ts` | It is the board-side bridge client; enforcement belongs in main/host handlers and must not rely on a board-side check. |

## Files Changed

| File | Planned change |
|---|---|
| `src/main/board-file-access.ts` | New main-owned canonical path authorization, Windows path normalization, board-root and selected-path scopes, and root-only protocol mode. |
| `src/main/board-bridge.ts` | Gate file RPCs and dialogs, record per-board dialog picks, and use the shared helper for reads/writes. |
| `src/main/board-trust-service.ts` | Expose a grant lookup by canonical root from the existing main-owned permission snapshot. |
| `src/ipc/api-types.ts`, `src/ipc/main/board-handlers.ts`, `src/ipc/renderer/api.ts` | Add host-renderer-to-main file authorization and board-bound session-src capability endpoints. |
| `src/renderer/editors/board/BoardWebview.ts`, `src/renderer/editors/board/BoardEditorModel.ts` | Authorize non-hosted local `content.open()` sources before provider I/O; retain host board identity. |
| `src/renderer/editors/board/board-pipe-handler.ts`, `src/main/board-protocol-service.ts` | Carry stream ownership and enforce content pipe checks; confine object-form board assets. |
| `src/renderer/content/providers/HttpProvider.ts`, `src/main/session-src-protocol.ts` | Bind session-backed remote content to trusted board identity and enforce local-address/MCP policy in main. |
| `src/shared/board-bridge-version.ts` | Required bridge-version bump for behavior changes. |
| `doc/active-work.md`, `doc/epics/EPIC-119.md` | Link the task from the active dashboard and epic task table. |
