# US-1690: Board folder listing and persisted folder and file grants

Epic: [EPIC-128](../../epics/EPIC-128.md) (decision A4, A6)

## Goal

Add a paged board bridge API for listing user-picked folders, plus user-approved persistent folder and exact-file grants. Folder grants are read-only; file grants allow read/write access to one picked file only. Both are visible and individually revocable in Board Info, and subordinate to the board's declared file-system permission.

This is EPIC-128 decisions A4 and A6. It does not implement the Audio Player.

### Live-test additions for bridge 1.38.0

- Add `persephone.getFileAccess(path): Promise<{ read: boolean; write: boolean }>` as a side-effect-free,
  no-prompt query. Resolve the path with `resolveAuthorizedPath()` for read and write intent against
  the current main-owned permission snapshot; return `false` for a `boardPermissionError`, and use
  `invalid-argument` only for a malformed path. This covers board-root access, current-session picks,
  delivered source files/source-read grants, remembered folder/file grants, and `fileSystem: "full"`.
- Document in the API JSDoc that boards should call it at startup to see whether a remembered catalog
  is writable. `rememberFile()` can prompt and is not an access check.
- Name `rememberFolder()` and `rememberFile()` confirmation dialogs with the manifest `name` when it
  exists, falling back to the board folder name. Repeating a remember call for an existing grant
  returns `true` without prompting.
- These additions are part of bridge **1.38.0**; do not bump `BOARD_BRIDGE_VERSION`.

## Background

### Verified current behavior

- src/main/board-file-access.ts owns pickedPathsByRoot, an in-memory map keyed by normalized board root. recordPickedPaths() records only paths returned by native dialogs. Folder picks cover descendants; file picks cover the exact file. openFileDialog and saveFileDialog both record file picks with folder: false. This map is lost on restart.
- In src/main/board-file-access.ts, resolveAuthorizedPath() is the existing shared authorization boundary. It validates input, resolves existing paths with fs.promises.realpath(), resolves relative paths against the real board root, and enforces containment through allowedByScope(). Windows comparison is case-insensitive; normalizeWindowsComponents() trims Windows trailing dots/spaces. validateRequestedPath() rejects device namespace forms \\?\ and \\.\, drive-relative paths such as C:foo, and colons outside a drive designator. isWithin() uses path.relative() and a path-segment boundary.
- allowedByScope() permits any resolved path for fileSystem: "full", denies external paths for false, and for "board" permits the board root plus current-session picks. resolveHostedReadOrAuthorizedPath() separately permits only the exact hosted-document read for fileSystem: false.
- src/main/board-bridge.ts defines exhaustive boardRpcHandlers: Record<BoardRpcMethod, BoardRpcHandler>. It checks main-owned permissions from boardTrustService.getGrantedPermissions(). openFolderDialog records picks; readFile calls resolveHostedReadOrAuthorizedPath() before reading; writeFile calls resolveAuthorizedPath() and recheckWriteTarget().
- src/ipc/board-bridge-channels.ts defines BoardRpcMethod and BoardToMain / MainToBoard request-reply envelopes. src/board-shim.ts rpc() sends calls; onPortMessage() copies an RPC error's string code to the rejected Error. src/main/board-bridge.ts returns the message and code.
- src/renderer/editors/board/board-api.d.ts declares the board API. It includes openFolderDialog(), openFileDialog(), saveFileDialog() and readFile(), but no listing or persisted-grant method.
- src/main/board-trust-service.ts owns trust and permission snapshots. init() reads <data folder>/trustedBoards.json, migrates trustedBoards.txt, and persists normalized grants through writeGrantsAtomically() (temporary file and rename). TrustedBoardGrant currently stores root, permissions and optional manifestChanged. setTrust() serializes mutations and broadcasts eBoardTrustChanged.
- src/renderer/api/board-trust.ts, src/renderer/api/board-trust-sync.ts, src/ipc/api-types.ts, src/ipc/main/board-handlers.ts, and src/ipc/renderer/api.ts implement the renderer trust mirror, main IPC and authoritative updates.
- src/renderer/editors/board-info/BoardInfoEditorModel.ts loads permission snapshots. src/renderer/editors/board-info/BoardInfoEditorView.ts renders granted permissions and pending permission changes; extend these to list and revoke remembered folders.
- doc/epics/EPIC-119.md defines the permission model: main enforcement, trust-owned permission snapshots, fileSystem: "board" for the board folder and picked paths, "full" for any accessible path, and bridge version bumps for behavior changes. EPIC-128 A4 adds persistent folder grants; A6 requires a user-owned Link Editor catalog file, which needs exact-file persistence that can read and write that file without granting its parent folder.
- src/shared/board-bridge-version.ts currently sets BOARD_BRIDGE_VERSION to 1.36.0. EPIC-128 says US-1689 may bump it first; US-1690 must use the next minor version at implementation time, not assume 1.37.0.
- File-access guidance is in assets/guides/boards.md, assets/guides/agents/boards.md, assets/guides/agents/board-review.md, and assets/board-template/CLAUDE.md. The agent/author references to update are assets/guides/agents/boards.md, assets/guides/agents/board-review.md, and assets/board-template/CLAUDE.md. Current bridge-version references also occur in assets/board-template/board-manifest.json (minBridgeVersion); doc/architecture/key-files.md documents the bridge-version source and history.

### Design

- Add persephone.listFolder(path, options?). Default recursive to false. Support up to 32 basename masks, each at most 256 characters, using only * and ? wildcard operators; reject path separators and match file basenames case-insensitively on Windows. Include directories regardless of masks so recursive results retain navigable paths. Each entry is { name, path, isDirectory, size, mtime }; path is canonical absolute, size is bytes (zero for directories), and mtime is Unix epoch milliseconds.
- Listing is allowed within the board root, a folder selected through that board's openFolderDialog, a persisted folder grant owned by that board, or anywhere accessible when effective fileSystem permission is "full". false remains denied for listing and dialogs; the existing hosted-document exception applies only to readFile. Persisted folder grants do not override manifest permission reductions and never permit writes.
- The feature requires only fileSystem: "board" plus the user's dialog selection and confirmation; it does not require the board service permission.
- Add persephone.rememberFolder(path) for a folder returned by that board's openFolderDialog. The main process shows an owner-window native confirmation dialog naming the board root and canonical folder; only an explicit affirmative response persists the grant, and cancel/window dismissal returns false. The board cannot turn an arbitrary path into a grant. Only "board" needs persisted grants; "full" already covers accessible folders.
- Add persephone.rememberFile(path) for an exact file returned by this board's openFileDialog or saveFileDialog in the current session, or this board's own plain local initial/runtime delivered source. Source-context items are excluded. The main process shows an owner-window native confirmation naming the board and file and stating that the board can read and change that file. Only affirmative confirmation creates the grant; cancel/window dismissal returns false. The grant never covers the file's parent or siblings. Under fileSystem: "board" it adds exact-file read/write access; "full" already grants broad access and false remains denied.
- Persist canonical folderGrants and exact fileGrants beside each board's root and permissions in main-owned trustedBoards.json, managed by boardTrustService's serialized atomic-write path. A file grant stores only its canonical path. For a saveFileDialog target that does not yet exist, derive that canonical path from the realpath of its parent plus the file name; do not store pending-creation or filesystem-identity state. Validate entries individually. Clear both grant types when a board is untrusted; Board Info can revoke either grant individually.
- Board Info shows Remembered folders and Remembered files sections for the current board, with canonical paths and a revoke button per grant. Revoking immediately removes the corresponding scope and refreshes the section.
- Folder grants add read/list scope only. Exact file grants add read/write scope for that one path; readFile honors folder and file grants, while writeFile honors file grants only (in addition to the existing board-root/session-pick/full scopes). For an existing target, every file-grant access requires the requested path's realpath to equal the stored canonical path exactly and the target to be a regular file. A not-yet-created save target is stored as realpath(parent) plus its name, with no pending-identity state; writeFile may create only that exact target, must still call recheckWriteTarget() immediately before writing, and must reject a directory or special-file target. An exact file grant never authorizes its parent directory or siblings.
- Use paging for large libraries: at most 1,000 entries/page and 100,000 entries/listing, counting files and directories, recursion depth 32, and cursor lifetime 5 minutes. Return nextCursor and truncated. Keep cursor state in main and bind it to board identity and authorized root. Revalidate on every page so revocation or permission changes invalidate cursors. Do not follow symlinks or Windows junction/reparse-point directories; skip those entries (including in-scope links) to avoid cycles. Re-authorize each descended directory and returned file through resolveAuthorizedPath().
- Stable RPC error codes: permission-denied for permission/scope refusal; invalid-argument for bad options, masks or cursors; not-found; not-directory; too-many-entries for a requested limit above the cap; depth-limit; cursor-expired; and io-error for other filesystem errors. Keep readable messages. Verified nuance: boardPermissionError() in src/shared/board-manifest-utils.ts currently puts permission-denied in the message, while src/main/board-bridge.ts only transmits a structured code when error.code is a string. Implementation must attach the code field for the new RPC errors (and permission-denied on this path); src/board-shim.ts already copies a transmitted code onto the rejected Error.

### Scope-check security invariant

Do not add a second path authorization algorithm. Resolve the requested root and every child with resolveAuthorizedPath() against the current main-owned permission snapshot. Existing code canonicalizes existing paths with realpath, normalizes Windows path components, checks containment with path.relative() and a segment boundary, and rejects device namespace and drive-relative paths. .. is resolved before containment, so it cannot escape the picked root. Symlink/junction traversal is refused; direct paths resolve through realpath() and an outside target fails the same containment check. UNC paths are not implicitly allowed: they must be inside the board root, a picked/persisted grant, or be covered by fileSystem: "full". C:music is rejected before resolution. Per-child authorization plus refusing traversal through links prevents a listing from widening the user's selected scope.

For a persisted file grant, record the canonical path at confirmation. Eligible paths are an exact current-session dialog file pick or this board's own initial/runtime delivered plain local source file; source-context items are excluded. Keep delivered source files and context items in separate main-owned maps so context membership cannot qualify for `rememberFile()`. If the picked saveFileDialog target does not exist yet, form its canonical path from the realpath of the parent directory and the file name; store no pending-creation marker or filesystem identity. On every access to an existing target, require realpath(requestedPath) to equal the stored canonical path exactly and require the target to be a regular file. This makes a symlink or junction introduced at the granted path, or in a parent directory, fail whenever it redirects elsewhere. A file replaced at the same canonical path remains granted; identity changes from git operations, cloud sync, and atomic-save editors do not revoke it. For a write to a not-yet-created save target, verify the canonical parent-plus-name path and use recheckWriteTarget() immediately before creation; the grant covers only that file path, never its parent or siblings. Reject directory and special-file targets.


### Source read grants (added 2026-10-11 from US-1688)

US-1688 found that a board with `fileSystem: "board"` cannot read the files Persephone hands it:
`content.open()` of a runtime `source.onOpen` URL, or of an item in a US-1689 source context,
fails with `permission-denied: "fileSystem"`. Both `content.open` paths authorize through
`api.authorizeBoardFilePath(boardRoot, path, "read")`
(`src/renderer/editors/board/board-pipe-handler.ts` `readChunk`, and
`src/renderer/editors/board/BoardEditorModel.ts` ~line 903), which calls
`resolveAuthorizedPath()` in main (`src/ipc/main/board-handlers.ts`, `Endpoint.authorizeBoardFilePath`).
So a music player could play only the one track it was opened with.

Rule: **a file Persephone delivers to a board is readable by that board for the session.**

- Delivered = the initial source (`getSourceUrl()`), every runtime `source.onOpen` URL, and every
  item `href` of a delivered `BoardSourceContext` (initial and runtime).
- Exact files only, **read intent only** (readFile, content.open); never folders, never listing,
  never write. Session-only (an in-memory map in main, like `pickedPathsByRoot`), cleared on
  untrust and on restart. Plain local paths only; URLs and archive paths are skipped (they are
  not file-system reads).
- The source URL itself is granted to every trusted board (the trust dialog already says a board
  can "work with the document you open in it"). Context items are granted only when the effective
  `fileSystem` permission is `"board"` or `"full"` (`"full"` needs nothing new); a
  `fileSystem: false` board gets the context list but cannot read its siblings.
- Granting happens in the renderer at delivery time, before the message is posted to the frame:
  `BoardWebview.transferPort()` (initial source + `initialSourceContext`) and
  `BoardWebview.flushPendingSourceUrls()` (runtime URL + context). New main IPC endpoint
  `grantBoardSourceReads(boardRoot, paths: string[])` in `src/ipc/api-types.ts`,
  `src/ipc/main/board-handlers.ts`, `src/ipc/renderer/api.ts`; await it before posting. It is NOT on
  the board bridge, so a board cannot grant itself anything. Main validates each path with the
  existing `validateRequestedPath()` / realpath, skips paths that do not exist or are not regular
  files, and stores canonical paths. `resolveAuthorizedPath()` read intent accepts an exact match.
- On page restore the initial context is restored from `sourceLink.sourceContext` (US-1689), and
  `transferPort()` grants it again, so source mode survives a restart. Runtime events are not
  replayed after a restart; a board keeps longer-lived access through remembered folders.
- Cap: at most 5,000 paths per call (the US-1689 context limit).
- Track delivered source files separately from context items. `rememberFile()` accepts only a plain
  local initial source (`getSourceUrl()`), a runtime `source.onOpen` URL delivered this session, or
  this board's own dialog-picked file; source-context items remain ineligible.
- Document it in the same guides as `listFolder` (`assets/guides/boards.md`,
  `assets/guides/agents/boards.md`, `assets/board-template/CLAUDE.md`, and the permission review
  checklist in `assets/guides/agents/board-review.md`).

Acceptance: with the probe board from US-1688 (`fileSystem: "board"`), opening a track from an
Explorer folder lets `content.open()` read every sibling in the context and every later
`onOpen` URL; a path not delivered still fails with `permission-denied`; `writeFile` to a
delivered path still fails.

## Implementation Plan

1. [x] **Persist and enforce grants**
   - In src/main/board-trust-service.ts, extend TrustedBoardGrant and parseTrustRecords() with optional validated canonical folderGrants and exact fileGrants; preserve current records and trustedBoards.txt migration. A file record contains only its exact canonical path. Add serialized add/list/revoke methods; clear both grant types from setTrust(root, false). Persist every change with writeGrantsAtomically().
   - In src/main/board-file-access.ts, keep pickedPathsByRoot for session picks. Add durable folder grants to "board" read/list scope only. Add exact file grants to "board" read/write scope only after exact realpath equality and regular-file validation; never expand them to parent folders. For an absent save target, use its canonical parent-realpath-plus-name path without pending-identity state. Add helpers verifying rememberFolder() and rememberFile() refer to current-session dialog picks.
   - Before -> after scope check:

     ```ts
     // Before: the resolver's "board" scope accepts current-session picks only.
     if (!allowedByScope(root, candidate, options.permissions)) throw boardPermissionError("fileSystem");

     // After: folders add read/list; files add exact-path read/write scope.
     if (!allowedByScope(root, candidate, options.permissions, options.intent, persistedGrants)) {
         throw boardPermissionError("fileSystem");
     }
     ```

2. [x] **Add listing and remember RPCs**
   - In src/ipc/board-bridge-channels.ts, add listing options, entry/page types, and listFolder / rememberFolder / rememberFile / getFileAccess to BoardRpcMethod.
   - In src/main/board-bridge.ts, implement handlers in boardRpcHandlers; validate arguments, use the current permission snapshot and shared resolver for root/children, implement pagination/cursor/depth limits, skip symlink/junction traversal, and attach stable error codes. `getFileAccess()` runs resolver checks for read and write intent and maps permission errors to false. `rememberFolder()` confirms read/list access to the canonical folder. `rememberFile()` accepts only the exact file path returned by this board's openFileDialog or saveFileDialog in this session and calls Electron's owner-window dialog.showMessageBox() naming the board and file and stating that the board can read and change it. Use the manifest name when available, falling back to the folder name. Persist only on affirmative confirmation; cancel/window dismissal returns false. Repeated remember calls for existing grants return true without prompting. `rememberFile()` persists no parent/sibling scope. A save target that did not exist at confirmation is stored as realpath(parent) plus name, without pending-identity state; allow writes to that exact target subject to recheckWriteTarget() and regular-file validation.
   - Only main's trust service writes persisted grants. No new IPC confirmation endpoint is needed because the bridge handler already has ownerWindow(entry.hostWebContents) for board-owned dialogs.

3. [x] **Expose the typed board API**
   - In src/board-shim.ts add persephone.listFolder(), persephone.rememberFolder(), persephone.rememberFile() and persephone.getFileAccess() wrappers using the new RPC names.
   - In src/renderer/editors/board/board-api.d.ts declare listing options, entry/page fields, all new methods, file grant behavior, and JSDoc. Explain that `getFileAccess()` is a no-prompt startup check for catalog writability because `rememberFile()` may prompt.
   - Before -> after public surface:

     ```ts
     // Before
     openFolderDialog(params?): Promise<string[] | undefined>;
     openFileDialog(params?): Promise<string[] | undefined>;
     saveFileDialog(params?): Promise<string | undefined>;
     readFile(path, options?): Promise<string | Uint8Array>;

     // After
     openFolderDialog(params?): Promise<string[] | undefined>;
     listFolder(path, options?): Promise<BoardFolderPage>;
     rememberFolder(path): Promise<boolean>;
     rememberFile(path): Promise<boolean>;
     readFile(path, options?): Promise<string | Uint8Array>;
     ```

4. [x] **Add Board Info controls**
   - Add main IPC list/revoke endpoints in src/ipc/api-types.ts, src/ipc/main/board-handlers.ts and src/ipc/renderer/api.ts. Revoke validates the exact board root and canonical folder/file grant; the board bridge cannot invoke it.
   - Extend src/renderer/api/board-trust.ts and src/renderer/api/board-trust-sync.ts to refresh authoritative folder/file grant state when main reports changes.
   - Extend src/renderer/editors/board-info/BoardInfoEditorModel.ts with folder/file data and revoke/refresh actions; extend src/renderer/editors/board-info/BoardInfoEditorView.ts with localized Remembered folders and Remembered files sections and per-grant revoke buttons.
   - Add English UI keys to src/shared/i18n/en/board.ts. Runtime fallback is verified in src/shared/i18n/resolve-message.ts: when no user or built-in pack has a key, it returns the English catalog value. package.json maps npm run i18n:check to scripts/i18n-check.mjs; scripts/i18n-check-entry.ts reports missing built-in pack keys but does not fail only for missing translations (it fails invalid/broken entries). Run npm run i18n:check to validate the new English entries; the 17 shipped packs need no new keys for fallback correctness.

5. [x] **Bump and document the bridge**
   - Bump BOARD_BRIDGE_VERSION in src/shared/board-bridge-version.ts to the next minor version then present; check whether US-1689 landed first.
   - Update current API/version history in assets/guides/boards.md, assets/guides/agents/boards.md, assets/board-template/CLAUDE.md, and doc/architecture/key-files.md. Check minBridgeVersion in assets/board-template/board-manifest.json and starter-version guidance in assets/guides/agents/board-review.md; update a requirement only where the starter or documented API actually requires the new method. At implementation time, use targeted search for 1.36.0 and BOARD_BRIDGE_VERSION to find any other current-version declaration; keep old release notes historical.

6. [x] **Update file-access guides**
   - Document API, scope, paging and errors in assets/guides/agents/boards.md and assets/board-template/CLAUDE.md.
   - Update permission audit/checklist in assets/guides/agents/board-review.md.
   - Update public API docs in assets/guides/boards.md. assets/guides/editors/board.md only links to the boards guide for file-access detail and needs no API change unless its link changes.

7. [x] **Source read grants** (section above): distinct main session maps for delivered source files
   and source-context items + `grantBoardSourceReads` IPC + read-scope check in
   `src/main/board-file-access.ts`; calls from `BoardWebview.transferPort()` and
   `flushPendingSourceUrls()`; clear on untrust. `rememberFile()` can promote only a delivered own
   source file or dialog-picked file, never a context item.

8. [x] **No unit tests.** Project guidance says this project does not use unit tests; do not add them.

## Concerns

- The host-owned confirmations must identify the board and exact canonical scope: a folder for read/list or one file for read/change. Default to cancel; do not silently persist a session pick.
- Extending trustedBoards.json is recommended because boardTrustService owns migration, atomic persistence and trust revocation. Malformed folder/file entries should be skipped individually without discarding valid board trust.
- Bind cursors to board identity/root and recheck authorization on every page; revocation or permission changes must invalidate access immediately.
- Verify directory-junction/reparse-point detection for supported Node/Electron versions. Skip uncertain entries rather than traversing them.
- RPC transports string error codes, but boardPermissionError() currently uses a message prefix rather than a structured code, and custom error typing is not declared in the board API. Add structured codes for this RPC path and document them.
- Select the next minor version after checking US-1689; update current-version docs and retain historical release notes.

## Acceptance Criteria

- persephone.listFolder(path, options?) is non-recursive by default, supports recursion and up to 32 basename masks (256 characters each; * and ? wildcards only; no path separators), and returns name, canonical path, isDirectory, size, and mtime.
- Listing requires board-root, dialog-picked or remembered-folder scope under fileSystem: "board"; "full" allows any accessible folder; false cannot list folders or open dialogs.
- A board using fileSystem: "board" can use listing and persisted folder grants without service permission.
- .., drive-relative paths, device namespace paths, out-of-scope UNC paths, and symlink/junction escapes cannot widen access. Root and child authorization reuses resolveAuthorizedPath().
- Limits are enforced: 1,000/page, 100,000/listing counting both files and directories, depth 32, cursor TTL 5 minutes, and no link traversal. Results expose nextCursor and truncated.
- rememberFolder() accepts only this board's dialog-picked folder, asks explicit user confirmation, persists across restart and returns false on cancel. Remembered scope permits list/read only.
- rememberFile() accepts only an exact file returned by this board's openFileDialog/saveFileDialog in the current session, or this board's initial/runtime delivered plain local source file; it never accepts a source-context item. It requires host confirmation that says the board can read and change the file, and persists only that exact file. It never grants the parent or siblings.
- `getFileAccess(path)` returns separate current read/write authorization booleans without prompting or side effects, using the same authorization resolver as file operations. Permission denials return false; malformed paths reject with `invalid-argument`.
- Persistent-grant confirmations use the manifest name when present and otherwise the board folder name. Repeating a remember call for an existing grant succeeds without another prompt.
- An exact-file grant never authorizes its parent directory or siblings. A save-dialog target that does not exist at confirmation is persisted as realpath(parent) plus name, with no pending-identity marker; writes may create only that exact target and still pass through recheckWriteTarget().
- readFile() honors remembered folder/file grants under "board"; writeFile() honors remembered file grants only and still passes through recheckWriteTarget(). Every access to an existing granted file requires exact realpath equality and a regular-file target; symlink/junction redirection fails. Same-path file replacement does not revoke the grant. Revocation removes scope; untrust removes both grant kinds.
- Board Info lists canonical folders and files for the current board and revokes each grant individually from main-owned state.
- Plumbing is complete across src/ipc/board-bridge-channels.ts, src/main/board-bridge.ts, src/main/board-file-access.ts, src/board-shim.ts and src/renderer/editors/board/board-api.d.ts.
- BOARD_BRIDGE_VERSION is bumped to the next minor version at implementation time, with current version documentation updated.
- assets/guides/agents/boards.md, assets/guides/agents/board-review.md, assets/board-template/CLAUDE.md and assets/guides/boards.md document the feature.
- English Board Info strings are added to src/shared/i18n/en/board.ts. Runtime uses the English fallback for missing app-pack keys; npm run i18n:check (scripts/i18n-check.mjs, implemented by scripts/i18n-check-entry.ts) reports missing built-in translations but does not fail on missing keys alone. No unit tests are added.


Files verified; no changes planned: src/shared/board-manifest-utils.ts (existing permission values suffice because folder grants are user data, not a manifest permission); assets/guides/editors/board.md (it links to the boards guide and has no separate API contract); existing Board Info stylesheets (reuse the current layout/components unless implementation shows a missing style hook).
## Files Changed Summary

| File | Planned change |
|------|---------------|
| src/main/board-file-access.ts | Include durable folder read/list and exact-file read/write grants in resolver-backed scope; preserve final write recheck. |
| src/main/board-trust-service.ts | Persist/list/revoke/clear per-board folder and file grants in the existing atomic trust record. |
| src/main/board-bridge.ts | Add listing, remember-folder, remember-file and get-file-access RPC handlers, pagination, confirmation, validation and coded errors. |
| src/ipc/board-bridge-channels.ts | Add RPC names, folder listing and file-access types. |
| src/board-shim.ts | Expose listFolder(), rememberFolder(), rememberFile() and getFileAccess(). |
| src/renderer/editors/board/board-api.d.ts | Declare typed listing, persisted folder/file grant and file-access APIs. |
| src/ipc/api-types.ts | Declare folder/file-grant IPC if needed. |
| src/ipc/main/board-handlers.ts | Register main-owned folder/file-grant IPC. |
| src/ipc/renderer/api.ts | Expose typed folder/file-grant IPC to renderer. |
| src/renderer/api/board-trust.ts | Mirror authoritative folder/file grants and mutations. |
| src/renderer/api/board-trust-sync.ts | Refresh grant state on main broadcasts. |
| src/renderer/editors/board-info/BoardInfoEditorModel.ts | Load grants and implement folder/file revoke refresh. |
| src/renderer/editors/board-info/BoardInfoEditorView.ts | Render remembered folders/files and revoke controls. |
| src/shared/i18n/en/board.ts | Add English Board Info grant/revoke labels; follow locale-pack rules for translated catalogs. |
| src/shared/board-bridge-version.ts | Bump to next minor version after checking US-1689. |
| assets/guides/boards.md | Document public API and version. |
| assets/guides/agents/boards.md | Document author API and permission behavior. |
| assets/guides/agents/board-review.md | Add reviewer checks for listing and remembered grants. |
| assets/board-template/CLAUDE.md | Update author/agent API and version guidance. |
| assets/board-template/board-manifest.json | Review minBridgeVersion for starter compatibility; update only if the template starts using the new API. |
| doc/architecture/key-files.md | Update bridge-version history. |
| doc/epics/EPIC-128.md | Link US-1690 to this task document. |
| doc/active-work.md | Link existing dashboard row to this document. |
