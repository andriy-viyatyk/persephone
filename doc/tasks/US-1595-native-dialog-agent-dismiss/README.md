# US-1595: Agents can see and dismiss native dialogs

**Epic:** none (follow-up raised during EPIC-118 / US-1592) · **Planned**

## Goal

An agent driving Persephone never gets stuck behind a native Windows dialog. It is told that a
dialog is open, sees what kind of dialog it is and its title, and can cancel it with one call.
To make that possible, no native dialog may block the main process while it is open, because
the main process hosts the MCP server.

**User decisions (2026-10-02):**
- Drop the "only the user can answer it — it cannot be answered by an agent" wording. An agent
  already opens and saves files through Persephone's own APIs, so the native dialog is not a
  consent boundary worth defending against it.
- Scope is **notify + cancel/dismiss**. The agent does not fill in a path or press Save/Open.
- Investigate making the download Save dialog asynchronous so the MCP server keeps answering.

## Background

### Where native dialogs come from (verified 2026-10-02)

| Call site | API | Blocks main? |
|---|---|---|
| `src/ipc/main/dialog-handlers.ts:16` open-file dialog | `dialog.showOpenDialog` (async) via `withNativeDialog` | No |
| `src/ipc/main/dialog-handlers.ts:44` save-file dialog | `dialog.showSaveDialog` (async) | No |
| `src/ipc/main/dialog-handlers.ts:65` open-folder dialog | `dialog.showOpenDialog` (async) | No |
| `src/main/download-service.ts:207` browser download Save As | `dialog.showSaveDialogSync` via `withNativeDialogSync` | **Yes** |
| `src/main/browser-service.ts:358-380` `will-prevent-unload` "Unsaved changes" box | `dialog.showMessageBoxSync` | **Yes** |

- **The tracker.** `src/main/native-dialog-tracker.ts` counts open dialogs per `BrowserWindow`, by kind (`file`, `folder`, `messageBox`).
  - `getNativeDialogAttention` builds the attention text: "…only the user can answer it — it cannot be answered by an agent."
  - `src/main/mcp/tools/call-tools.ts:235-255` attaches that text to call results. When the renderer times out it returns `pending: true` instead.
- **Why the sync dialogs block everything.** `showSaveDialogSync` and `showMessageBoxSync` block the main process's event loop, and the MCP HTTP server runs there.
  - During the US-1592 verification, an MCP `click` that opened a download dialog did not return until the dialog closed.
  - No MCP call can be served while one of these dialogs is open, so no dismiss call could reach Persephone either.
- **Why the download dialog is sync.** `dialog-folder-memory.ts:15-17`: Electron's `will-download` requires `item.setSavePath()` before the handler returns. If it is not called, Electron uses its own routine, and `download-service.ts:192-193` notes that `getSavePath()` then comes back empty for webview downloads.
- **Why the unload box is sync.** `will-prevent-unload` is decided by calling `event.preventDefault()` inside the handler.
- **No cancel API for file dialogs.** Electron can cancel an async `showMessageBox` with an `AbortSignal` (`signal` option), but `showOpenDialog`/`showSaveDialog` have no cancel API. Closing a file dialog takes a Win32 call against its window.
- **`persephone-snip.exe`** (`snip-tool/`, Rust, `windows-sys`) already hosts small native subcommands: `clipboard-*`, `sso-cookies`. It is the place for a Win32 helper.

## Implementation plan

The steps are outlined here. Re-verify the cited lines and fill in the code snippets when the task starts.

### 1. Make the download Save dialog asynchronous — `src/main/download-service.ts`

This follows Chrome's own model: the download starts at once into a temporary file, and the dialog runs in parallel.

1. In `handleOrdinaryDownload`, set the save path at once to a temp file.
   - Use `<app temp>/persephone-downloads/<id>.part`, and create the folder on demand.
   - Then show `dialog.showSaveDialog` (async) through `withNativeDialog`, with the same `resolveDefaultPath` and `rememberDirFromPick` logic.
   - The entry starts with the suggested file name and a new `awaitingPath` state, or `status: "downloading"` with no `savePath`; decide which when the task starts.
2. **The user picks a path:**
   - If the download is still running, record the path. When it completes, move the temp file there.
   - If it has already completed, move it now.
   - Move with `fs.promises.rename`, falling back to copy + unlink across volumes. Overwriting an existing file was already confirmed by the dialog.
   - Write the US-1592 Mark-of-the-Web after the move, then send `eDownloadCompleted`.
3. **The user cancels:** `item.cancel()` if it is still running, and delete the temp file.
4. **Interrupted or failed:** delete the temp file. The behavior is otherwise unchanged.
5. **On startup,** delete leftover `*.part` files in the temp folder, from a crash or a forced quit.
6. Update the comment in `dialog-folder-memory.ts:15-17`. After this change the download path can call the shared async logic. Fold the sync variant into it if nothing else uses it.

### 2. The unload confirmation — `src/main/browser-service.ts:358-380`

This dialog has to stay synchronous: the decision is `event.preventDefault()` inside the handler, and the pending action, whether reload, navigation or close, cannot be replayed afterwards.

**Proposal:** while an agent session is active, skip the box and allow the unload, as Playwright does by default. Detect the session the way `call-tools.ts` knows a request is in flight, or with a "recent MCP activity" timestamp. Decide this when the task starts.

Alternatively, accept that this one box blocks MCP. A beforeunload prompt only appears after a user or agent tries to leave a page with unsaved form input.

### 3. Cancel a native dialog — `snip-tool`

1. New subcommand: `persephone-snip.exe dialog-cancel <ownerHwnd>`.
   - `EnumWindows` for top-level windows of class `#32770` (the common dialog class) whose owner (`GetWindow(GW_OWNER)`) is `ownerHwnd`, in the calling app's process.
   - Send each one `WM_COMMAND(IDCANCEL)`, falling back to `WM_CLOSE`.
   - Print JSON `{ "cancelled": <count>, "titles": [...] }`.
   - Targeting by owner window means it can never touch another application's dialog. That rules out the `SendKeys` approach.
2. Optional: `dialog-info <ownerHwnd>` returns titles only, for the notification in step 4.
3. Main side: a `cancelNativeDialogs(browserWindow)` helper in `native-dialog-tracker.ts`. It spawns the subcommand with `browserWindow.getNativeWindowHandle()` (read as a pointer-sized integer) and returns the parsed result. Follow the spawn pattern in `clip-service.ts`.
4. For message boxes shown through the async API, prefer the `AbortSignal` route and keep an `AbortController` per open box in the tracker.

### 4. Expose it to agents — AiVision

1. Reword `attentionText` in `native-dialog-tracker.ts`:
   - "A native file dialog is open in window N (title: …). The user can answer it, or call `windows[i].nativeDialog.dismiss()` to cancel it."
   - Keep the `pending: true` behavior in `call-tools.ts`.
2. A new main-process node, `windows[i].nativeDialog`, next to the existing `windows` members in `src/main/mcp/ai-vision/main-root.ts` / `main-services.ts`. Follow how the window nodes there are declared.
   - `open: boolean`
   - `kind`: `"file"` / `"folder"` / `"messageBox"` / undefined
   - `title` (from `dialog-info`, when available)
   - `dismiss(): { cancelled: number }`, which cancels and never confirms.
3. Add the node to the ai-vision guide text the window nodes already have (`$help`), and to `assets/guides/agents/` where native-dialog behavior is described. Search for the current attention wording.

### 5. Checks

- typecheck, lint, build-prod; `cargo build --release` for `snip-tool`.
- **Live, dev:**
  1. A browser download started by `click()` returns at once. `windows[0].nativeDialog` shows `open: true, kind: "file"`. `dismiss()` closes it, the temp file is deleted, and no download entry is left.
  2. The same download saved by the user: the file is at the chosen path with Mark-of-the-Web, and the download list entry is correct, for both a small (already-completed) download and a large (still-running) one.
  3. Open-file and save-file dialogs from the renderer: `dismiss()` closes them, and the waiting script gets its usual cancel result.
  4. Another application's Save As window stays untouched by `dismiss()`.

## Files changed (expected)

| File | Change |
|---|---|
| `src/main/download-service.ts` | Async Save dialog; temp download + move; cleanup |
| `src/main/dialog-folder-memory.ts` | Comment, sync variant folded |
| `src/main/browser-service.ts` | Unload-box handling under automation (per decision) |
| `src/main/native-dialog-tracker.ts` | Attention wording; titles; `cancelNativeDialogs` |
| `src/main/mcp/ai-vision/*` | `windows[i].nativeDialog` node |
| `snip-tool/src/main.rs`, new `snip-tool/src/dialogs.rs` | `dialog-cancel` / `dialog-info` subcommands |
| `assets/guides/agents/…` | Native-dialog behavior for agents |

## Concerns / Open questions

1. **Download states.** A download that finishes before the user picks a path is "completed into temp, waiting for a path". The downloads UI must not offer "Open" until the move is done. Check `DownloadEntry` consumers in the renderer when the task starts.
2. **Unload confirmation:** skip it under automation, or leave it blocking (step 2). Recommendation: skip under automation.
3. **Window handle.** `getNativeWindowHandle()` returns a `Buffer` holding the HWND. Read it as `readBigUInt64LE` on x64 and pass it as a decimal string.
4. **Modal-dialog state in the tracker** stays the source of truth for `open`/`kind`. `dialog-info` only adds titles, and a failed spawn must not hide an open dialog.

## Acceptance criteria

- No native dialog blocks the MCP server, apart from the unload box if that is the decision for step 2.
- `windows[i].nativeDialog` reports an open dialog's kind and title.
- `dismiss()` cancels it, and only dialogs owned by that Persephone window.
- A cancelled download leaves no file and no entry.
- A saved download lands at the chosen path with Mark-of-the-Web.
- The attention text no longer says an agent cannot answer.

## Progress

- [ ] Async download dialog (temp + move)
- [ ] Unload-box decision + change
- [ ] `snip-tool` `dialog-cancel` / `dialog-info`
- [ ] Tracker + `windows[i].nativeDialog`
- [ ] Guides
- [ ] Checks
