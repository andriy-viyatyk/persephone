# US-1753: Agent API for board shortcuts and board windows

## Goal

Expose `boards.createShortcut()` and `boards.openBoardWindow()` to MCP agents and scripts so they can create the same Windows shortcut as the UI and launch or focus a board in its own board-mode window. The agent Object Model methods require a valid, trusted or bundled board; the UI shortcut remains available for untrusted open boards so their shortcut can show the normal trust dialog when launched. Shortcut creation supports either the existing Save dialog or a validated explicit `.lnk` destination.

## Background

This is a standalone follow-up to completed [EPIC-136: Boards as standalone apps](../../epics/EPIC-136.md). EPIC-136 established the `--board <folder>` launch route, one board-mode window per root, board-specific taskbar identity, and the UI's **Create shortcut…** action.

`src/renderer/editors/board/board-shortcut.ts` currently owns the UI action. `createBoardShortcut(root)` reads board display metadata, shows `fs.showSaveDialog()` with a `.lnk` filter and a default path in the board folder, renders the board icon, calls `api.createBoardShortcut()`, then catches failures and reports them with UI notifications. Its only callers are the board context menus in `src/renderer/ui/sidebar/EditorsTreeView.ts`, `src/renderer/editors/board/BoardEditorModel.ts`, and `src/renderer/editors/explorer/BoardsSecondaryView.ts`. The page-tab menu in `BoardEditorModel.ts` is available for an open untrusted board, matching EPIC-136's decision that a shortcut may target an untrusted board and launch its normal trust dialog. Refactor this module so a shared core accepts optional shortcut options and returns `linkPath | null` while throwing failures; keep notification behavior in a UI-only wrapper and do not put the agent trust check in this shared UI/core function.

`src/ipc/main/core-handlers.ts` implements `createBoardShortcut`. The handler verifies that its sender belongs to a Persephone `BrowserWindow` and validates the icon payload, then writes and reads back a Windows shortcut. It uses `getBoardLauncherPath()`, `boardRootForLaunchArgs()`, `boardIdentityHash()`, and `writeBoardWindowIcon()` from `src/main/board-window-identity.ts`; the shortcut target, `--board` argument, icon, and `Persephone.Board.<hash>` AppUserModelID match the board-window identity. The handler currently does not validate the `.lnk` destination or check for an existing file before writing. `src/ipc/main/endpoint-registry.ts` applies the common IPC sender guard; that restricts calls to live Persephone app windows, but not to a particular window type or UI action.

`src/main/open-windows.ts` already exposes `openBoardWindow(root)`, which focuses the existing board window by normalized root or creates a new board-mode `OpenWindow`. `src/main/pipe-server.ts` receives the launcher's `BOARD` message and routes it through `openWindows.handleLaunchInput()`; `src/main/open-window.ts` builds the board-window relaunch command using the same launcher and `--board` argument. There is no current renderer IPC endpoint that calls `openWindows.openBoardWindow()` directly.

The renderer's `boards` Object Model is implemented by `src/renderer/api/boards.ts` and typed by `src/renderer/api/types/boards.d.ts`. `boards.openBoard()` verifies `isBoardFolder()` and opens a regular board tab through the `persephone-board://` pipeline. `registerBoard()` uses `requestBoardTrust()`, which treats bundled boards as trusted and otherwise checks ancestor-aware `boardTrust.isTrusted()` before asking for user consent. The `boards.list()` implementation reads trust state and bundled status for its local inventory. The two new agent Object Model methods must refuse untrusted roots up front rather than relying on the board-mode window's normal trust dialog. Keep this check in `src/renderer/api/boards.ts`, using `boardTrust` and `bundledBoardRegistry`; do not add it to the shared UI shortcut path or main IPC handlers.

MCP discovers the `boards` object through `src/renderer/scripting/ai-vision/namespaces/boards.ts`; `app.boards` is exposed by the descriptor-backed getter in `src/renderer/scripting/api-wrapper/AppWrapper.ts`, and the public script typings flow through `IBoards` in `src/renderer/api/types/boards.d.ts` and `IApp` in `src/renderer/api/types/app.d.ts`. `assets/guides/agents/boards.md` documents these call surfaces. The `boards` node is explicitly covered by `qa/surfaces/editors/boards.md`, linked from `qa/surfaces/README.md`.

These additions are host-side Object Model / MCP operations, not methods on the board's `persephone` bridge. **Do not bump `BOARD_BRIDGE_VERSION`** or require a board manifest `minBridgeVersion` change.

### API shape

Before:

```ts
boards.openBoard(boardRoot: string): Promise<void>; // regular tab
// No agent shortcut or board-window operation.
```

After:

```ts
boards.createShortcut(
    boardRoot: string,
    opts?: { linkPath?: string; overwrite?: boolean },
): Promise<{ linkPath: string } | null>;

boards.openBoardWindow(boardRoot: string): Promise<void>;
```

When `linkPath` is omitted, `createShortcut()` shows the existing Save dialog and returns `null` if the user cancels. When supplied, `linkPath` must be absolute, end in `.lnk` case-insensitively, and have an existing parent directory. An existing explicit target is refused unless `overwrite: true`. The returned `linkPath` is the resolved absolute path that was written. Errors reject to the caller with a message naming the problem (for example, `Not a board folder`, `Board is not trusted; call boards.registerBoard(root) first`, `linkPath must be absolute`, or `File exists; pass overwrite: true`); the agent path must not send UI notifications.

## Implementation Plan

1. [x] **Refactor the existing shortcut flow into a shared core.** In `src/renderer/editors/board/board-shortcut.ts`, retain the existing display-name, manifest, `.lnk` filter, icon rendering, and main-process request construction. Add an options input for an explicit destination and overwrite flag; show the existing `fs.showSaveDialog()` only when no destination is provided. Return `null` on dialog cancellation and `{ linkPath }` with the resolved absolute path after verified creation. Let failures reject. Keep the current UI-facing exported action as a wrapper that invokes the shared core and preserves the existing success/failure notifications, so the three current context-menu callers behave as they do today. When the Save dialog returns a path, pass `overwrite: true` to main because the native dialog already confirmed replacement; this preserves UI overwrite behavior. Do not apply the agent trust check in this shared module, since the UI shortcut is intentionally available for untrusted boards. The `boards.createShortcut()` implementation should call the shared core directly and must not use the notification wrapper.

2. **Enforce destination rules in main.** Extend `CreateBoardShortcutRequest` in `src/ipc/api-types.ts` with `overwrite?: boolean` and update its endpoint type and renderer transport in `src/ipc/renderer/api.ts`. In `src/ipc/main/core-handlers.ts`, validate `linkPath` with the main process's `node:path` and filesystem APIs: it must be absolute, have a case-insensitive `.lnk` extension, and have an existing parent directory. For an explicit caller-supplied `linkPath`, reject an existing target unless `overwrite === true`; throw an actionable error such as `File exists; pass overwrite: true` before calling `shell.writeShortcutLink()`. The UI Save-dialog path passes `overwrite: true` after the native dialog confirms replacement, preserving current UI behavior. Preserve the existing shortcut read-back verification and throw if creation fails or verification does not match. The common IPC sender guard only ensures a live app window; do not treat it as authorization for a requested destination.

3. **Validate board roots and apply the agent-only trust precondition.** In both new methods in `src/renderer/api/boards.ts`, use `fpIsAbsolute()` and `fpResolve()` from `src/renderer/core/utils/file-path.ts` to reject relative roots and resolve accepted absolute roots before checking them. Use `isBoardFolder()` to require a folder containing `board-manifest.json`, with an actionable error such as `Not a board folder: "<root>" is missing or has no board-manifest.json.` Load `boardTrust` and initialize `bundledBoardRegistry` before checking `boardTrust.isTrusted(root)` or `bundledBoardRegistry.isBundled(root)`; otherwise reject with `Board is not trusted; call boards.registerBoard(root) first.` Do this only in the agent Object Model methods. Do not invoke `registerBoard()` or the trust dialog, and do not add a trust check to the shared UI shortcut path or main handlers. The main `openBoardWindow` handler independently resolves the root and validates that its `board-manifest.json` exists before opening the window, but performs no trust check.

4. **Add the Object Model methods and typings.** In `src/renderer/api/boards.ts`, implement `createShortcut()` by resolving and validating the absolute board root, checking `isBoardFolder()`, requiring `boardTrust.isTrusted()` or `bundledBoardRegistry.isBundled()`, then calling the shared shortcut core. For a supplied `linkPath`, provide an early actionable validation error for a relative path and pass its `fpResolve()` result; main still owns authoritative destination checks. Implement `openBoardWindow()` with the same renderer-side root, manifest, and trust checks, then invoke a new typed renderer-to-main endpoint with the resolved root. In `src/renderer/api/types/boards.d.ts`, add documented signatures and contracts for both methods, including cancellation, validation, overwrite behavior, trust requirement, resolved return path, and actionable error behavior. `AppWrapper` exposes service getters from `appServiceDescriptors`, so its generic `boards` getter should need no special-case code; keep its type coverage intact.

5. **Add the renderer-to-main board-window IPC.** Add an `Endpoint.openBoardWindow` contract taking `boardRoot: string` and returning `Promise<void>` in `src/ipc/api-types.ts`, expose it from `src/ipc/renderer/api.ts`, and register the guarded handler in `src/ipc/main/core-handlers.ts` beside the existing board shortcut endpoint. The handler resolves the root with main-process `path.resolve()`, validates that `<root>/board-manifest.json` exists, then calls `openWindows.openBoardWindow(resolvedRoot)` from `src/main/open-windows.ts`. Do not add a main-side trust check: an untrusted root rejected by the agent Object Model method remains openable through a shortcut, by design, and its board-mode window presents the normal trust dialog. Reuse the current one-window-per-board focus behavior. Do not route through `boards.openBoard()`, since that opens a tab in the current window rather than a board-mode window.

6. **Describe the methods to MCP agents.** In `src/renderer/scripting/ai-vision/namespaces/boards.ts`, add `createShortcut` and `openBoardWindow` to `BOARDS_MEMBERS` with exact signatures, summaries, and cautions: shortcut creation writes a `.lnk` (and may show a Save dialog); board-window opening creates or focuses a visible window. Explain in the `help` string that both reject untrusted non-bundled boards, contrast `openBoard()`'s ordinary-tab behavior with `openBoardWindow()`, and describe the Save dialog / explicit `linkPath` / overwrite rule.

7. **Update agent guidance and the existing boards QA surface.** Add the new host-agent calls and their contracts to `assets/guides/agents/boards.md`, in its board creation/open flow and/or lifecycle section; clarify that `app.boards` has the same methods and that board trust remains a prerequisite. Add manual scenarios to `qa/surfaces/editors/boards.md` for Save-dialog cancel, explicit valid path, invalid relative/non-`.lnk`/missing-parent destinations, overwrite refusal and opt-in, untrusted-target refusal, creating/focusing a board-mode window, manifest validation, and confirming `openBoard()` still opens an ordinary tab. The surface is already listed in `qa/surfaces/README.md`; no index change is needed unless the QA inventory structure changes.

8. **Manually verify the acceptance criteria.** Use the existing manual MCP/surface workflow; do not add or run unit tests or a test harness. Check both the MCP `call` descriptors and `app.boards` script typings/docs, exercise trusted and untrusted targets, verify that cancellation is `null` and failures reach the caller without a toast, and verify that repeated `openBoardWindow()` calls focus one window per board. Confirm all three current UI shortcut callers retain their notification behavior.

## Progress

- [x] Step 1: Refactored shortcut creation into a shared core and retained the UI notification wrapper.
- [x] Step 2: Added main-process destination validation and overwrite enforcement.
- [x] Step 3: Added renderer-side board-manifest and agent trust checks.
- [x] Step 4: Added the Object Model methods and public typings.
- [x] Step 5: Added guarded renderer-to-main board-window IPC.
- [x] Step 6: Added MCP member descriptors and help text.
- [x] Step 7: Updated agent guidance and manual boards QA scenarios.
- [ ] Step 8: Manual verification — left to the user as requested.

## Concerns / Open questions

- **Trust policy differs by caller:** agent Object Model calls must reject an untrusted, non-bundled board before opening UI or showing a Save dialog. The UI shortcut must remain available for an untrusted board because EPIC-136 intentionally allows its shortcut to launch the board-mode window and show the normal trust dialog; `BoardEditorModel` offers that shortcut on any open board page. Keep the trust check only in `src/renderer/api/boards.ts` for the agent methods. Do not add trust validation to main: renderers have `nodeIntegration: true` and can already write files and spawn processes, so checking trust in the shortcut IPC handler would not create a security boundary and would duplicate bundled discovery from `readBundledSources()`.
- **Overwrite behavior:** the current handler uses `shell.writeShortcutLink(path, "create", ...)` without an existing-file check. Enforce the explicit-path refusal in main before the write; `overwrite: true` is the only agent opt-in to replacing an existing explicit target. The UI Save-dialog path carries `overwrite: true` only after the native dialog's confirmation, preserving its existing replacement behavior. Keep Save-dialog cancellation distinct from a write error.
- **Bridge version:** no `BOARD_BRIDGE_VERSION` increment is required because neither method is added to the board-owned `persephone` bridge or `persephone.call()` surface. They are host Object Model methods (`app.boards`) and MCP renderer namespace methods.
- No other design question is open; method names, signatures, return values, path validation, overwrite policy, and caller-specific trust policy are decided above.

## Acceptance Criteria

- [ ] `boards.createShortcut(boardRoot, opts?)` and `app.boards.createShortcut(boardRoot, opts?)` are available with the documented signature and `{ linkPath } | null` result.
- [ ] Without `linkPath`, shortcut creation uses the existing Save dialog and returns `null` on cancel; with `linkPath`, it shows no dialog.
- [ ] Main rejects non-absolute shortcut destinations, paths without a case-insensitive `.lnk` extension, paths whose parent folder is missing, and existing explicit targets unless `overwrite: true`; the UI passes `overwrite: true` only after the Save dialog has confirmed replacement.
- [ ] Shortcut creation preserves the UI shortcut's launcher target, `--board` argument, board icon, board description, and `Persephone.Board.<hash>` AppUserModelID; its existing context-menu flow still reports success/failure through UI notifications.
- [ ] The UI **Create shortcut…** action remains available on an untrusted open board and creates a shortcut whose launched board window presents the normal trust dialog.
- [ ] The agent/script path throws errors to its caller without showing UI notifications.
- [ ] Both agent methods resolve and validate absolute board roots in the renderer, reject a missing `board-manifest.json` with a board-folder error, and reject an untrusted, non-bundled board with an error directing the caller to `boards.registerBoard(root)`; neither agent method opens a trust dialog.
- [ ] The main `openBoardWindow` handler resolves its input and rejects a missing `board-manifest.json` before creating/focusing a window, without checking trust; untrusted roots remain launchable through shortcuts and show the normal window trust dialog.
- [ ] `boards.openBoardWindow(boardRoot)` and `app.boards.openBoardWindow(boardRoot)` open the board in its own board-mode window; repeated calls focus the existing window for that root.
- [ ] Existing `boards.openBoard(boardRoot)` behavior remains the regular-tab path.
- [ ] The MCP `boards` descriptor/help, `IBoards` TypeScript/JSDoc typings, `assets/guides/agents/boards.md`, and manual `qa/surfaces/editors/boards.md` scenarios document the additions and their cautions.
- [ ] `BOARD_BRIDGE_VERSION` is unchanged.

## Files Changed Summary

| File | Planned change |
|------|----------------|
| `src/renderer/editors/board/board-shortcut.ts` | Extract shared shortcut creation core; preserve UI notification wrapper; accept options and return a cancellation/result value. |
| `src/renderer/api/boards.ts` | Add trust-checked `createShortcut()` and `openBoardWindow()` Object Model implementations. |
| `src/renderer/api/types/boards.d.ts` | Add the public `IBoards` signatures and detailed contract/JSDoc. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Add MCP member descriptors, cautions, and help text. |
| `src/ipc/api-types.ts` | Extend shortcut request and add typed board-window endpoint contract. |
| `src/ipc/renderer/api.ts` | Add typed renderer methods for shortcut creation and board-window opening. |
| `src/ipc/main/core-handlers.ts` | Validate shortcut destination, enforce overwrite policy, validate board-window roots, and register board-window handler; no trust check. |
| `assets/guides/agents/boards.md` | Document the agent and script methods. |
| `qa/surfaces/editors/boards.md` | Add manual MCP coverage for shortcut and board-window operations. |
| `doc/active-work.md` | Link US-1753 under Active → `*(no epic)*`. |
| No change: `src/main/board-window-identity.ts` | Existing launcher, icon, board identity hash, and AppUserModelID helpers are reused. |
| No change: `src/main/open-windows.ts` | Existing `openBoardWindow(root)` creates or focuses the board-mode window. |
| No change: `src/main/board-trust-service.ts` | No main-owned trust helper is needed; trust is checked by the agent Object Model methods only. |
| No change: `src/main/pipe-server.ts`, `src/main/open-window.ts` | Existing `BOARD` / `--board` routing and relaunch behavior remain the reference path. |
| No change: `src/renderer/scripting/api-wrapper/AppWrapper.ts` | The descriptor-backed `boards` getter exposes the Object Model service without a per-method wrapper. |
| No change: `src/renderer/api/types/app.d.ts` | `IApp.boards` already refers to `IBoards`, so the new methods flow through that service type. |
| No change: `qa/surfaces/README.md` | The boards surface is already listed and remains the same surface. |
| No change: `src/shared/board-bridge-version.ts` / `BOARD_BRIDGE_VERSION` | No board-facing bridge capability is added. |
