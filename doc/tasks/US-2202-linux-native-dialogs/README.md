# US-2202: Native-dialog tracker and board shortcut on Linux

**Epic:** [EPIC-212](../../epics/EPIC-212.md) · **Status:** Planned

## Goal

Keep window-routed MCP calls usable while a tracked native dialog is open off Windows, and reject unsupported board-shortcut creation before opening a dialog. Preserve Windows behavior.

## Background

[Runtime findings R-2 and R-3](../../reviews/multiplatform-2026-11/runtime-findings.md) were observed on WSL Ubuntu 26.04 with XWayland. R-2: `src/main/native-dialog-tracker.ts` reads an eight-byte HWND from Electron's four-byte Linux X11 handle, causing a `RangeError` while `src/main/mcp/tools/call-tools.ts` adds attention to window-routed calls. The helper commands `dialog-info` and `dialog-cancel` are implemented by the Windows snip executable (`snip-tool/src/main.rs`); they cannot inspect Linux dialogs. `activeDialogs` already tracks counts and kinds independently of the helper. `src/main/mcp/ai-vision/main-root.ts` exposes `windows[i].nativeDialog` and delegates state and dismissal to the tracker.

R-3: `src/shared/platform-features.ts` already marks `desktop.boardShortcut` unavailable on Linux, macOS and unsupported platforms. `src/renderer/api/boards.ts` resolves trust and calls `createBoardShortcutCore` in `src/renderer/editors/board/board-shortcut.ts`, which opens a Save dialog unless `linkPath` is supplied, then calls `src/main/board-window-identity.ts` through IPC; that main owner writes a Windows `.lnk` with `shell.writeShortcutLink`. The same renderer core serves board UI actions. The current tree has no consumer of `desktop.boardShortcut` outside the table, so the existing board shortcut actions are not actually gated by that feature. `src/renderer/scripting/ai-vision/namespaces/boards.ts` advertises the method without availability; `namespaces/shell.ts` and `src/ipc/main/clipboard-handlers.ts` show the US-2199 help and `Error(reason)` patterns.

The named `src/renderer/editors/settings/fields/ShortcutField.ts` and `src/renderer/editors/settings/sections/SettingsSections.ts` implement **voice-typing keyboard shortcuts**, not board `.lnk` shortcuts. There is no board shortcut settings field in these files; do not gate those unrelated settings with `desktop.boardShortcut`. Board actions are in `BoardEditorModel.ts`, `BoardsSecondaryView.ts` and `../tools-hub/EditorsTreeView.ts` under `src/renderer/editors/`.

Repository-wide search for `getNativeWindowHandle()` found one other reader: `WindowsVirtualDesktopAdapter.hwnd` in `src/main/virtual-desktop-manager.ts`. It explicitly handles both eight- and four-byte buffers; `VirtualDesktopManager.getAdapter()` already rejects non-Windows before constructing that adapter. It is not an unguarded eight-byte reader and needs no change. No other such reader was found.

## Implementation Plan

- [x] **Tracker owner: `src/main/native-dialog-tracker.ts`.** Reuse `isWindows` from `src/shared/platform.ts`; no existing feature ID describes native dialog inspection/cancellation, and `screen.snip` describes capture rather than this helper capability. Do not introduce a platform check or feature ID. After the existing window/state checks in `getNativeDialogState`, return `{ open: true, kind: activeKind }` off Windows before calling `ownerHwnd` or `runDialogCommand`. Keep `{ open: false }` for absent, destroyed, or untracked windows. On Windows leave helper inspection and optional title unchanged.

  ```ts
  // Before: every tracked dialog reads an HWND.
  const result = await runDialogCommand(["dialog-info", ownerHwnd(browserWindow)]);
  // After: return tracked state before the existing Windows helper path.
  if (!isWindows) return { open: true, kind: activeKind };
  const result = await runDialogCommand(["dialog-info", ownerHwnd(browserWindow)]);
  ```

- [x] In the same owner, keep aborting every registered `messageBoxControllers` controller first. Off Windows return `{ cancelled: 0, titles: [], reason: "Native dialog cancellation is not available on this platform." }` before reading a handle or spawning; do not count abort requests as confirmed cancellations. Extend the result type with optional `reason`, preserving the Windows result shape and destroyed-window behavior. Currently the controller set has no registration sites, so this does not claim it closes current dialogs; file/folder dialogs still require user dismissal. Do not add a controller registration mechanism in this task.

  ```ts
  // Before: after aborting controllers, all live windows invoke dialog-cancel.
  if (browserWindow.isDestroyed()) return { cancelled: 0, titles: [] };
  const result = await runDialogCommand(["dialog-cancel", ownerHwnd(browserWindow)]);
  // After: keep that destroyed-window return, then branch before the existing helper call.
  if (!isWindows) return { cancelled: 0, titles: [], reason: "Native dialog cancellation is not available on this platform." };
  ```

- [x] In `getNativeDialogAttention`, retain the existing Windows text. Off Windows report the tracked kind and window index without a title, and say native cancellation is unavailable and the user should close the dialog; do not suggest that `dismiss()` can cancel a file picker. `src/main/mcp/ai-vision/main-root.ts` owns its MCP descriptions: adjust `WINDOW_MEMBERS`, `WINDOWS_HELP`, `NATIVE_DIALOG_MEMBERS` and `NativeDialogNode.aiVision` to describe this platform limitation while preserving the Windows description, using the shared `isWindows` predicate. `dismiss()` forwards the tracker's optional reason without changing its absent-window fallback. No new IPC protocol is needed.

- [x] **Shortcut execution owner: `src/renderer/editors/board/board-shortcut.ts`**, at the start of `createBoardShortcutCore`, reuse `getPlatformFeature("desktop.boardShortcut")` and throw `new Error(availability.reason)` when unavailable, before manifest work, the Save dialog, icon rendering or IPC. All script/MCP and board UI paths converge here; keep the gate there rather than duplicating it in callers or `createBoardShortcut` in the main process. `boards.createShortcut` currently validates root/trust and an explicit path before reaching the core; valid trusted calls must receive the availability error, and none of those checks opens a dialog. Keep those validations and Windows ordering intact.

  ```ts
  // Before: createBoardShortcutCore begins by reading the manifest.
  const manifest = await readBoardManifest(root);
  // After: reject unsupported platforms before any shortcut work.
  const availability = getPlatformFeature("desktop.boardShortcut");
  if (availability.available === false) throw new Error(availability.reason);
  const manifest = await readBoardManifest(root);
  ```

- [x] **MCP help owner: `src/renderer/scripting/ai-vision/namespaces/boards.ts`.** Reuse `getPlatformFeature` as `namespaces/shell.ts` does: append the unavailable reason to the `createShortcut` member summary and descriptor help only when unavailable. Preserve Windows help text. Existing UI action wrappers catch the core error and show the reason in their failure notification. The feature's intended UI hiding is separate from the execution gate: hide the three board menu actions using the existing feature table at their menu construction points if they are currently shown, without adding additional execution gates. Leave voice-typing settings alone.
- [x] Run `npm run typecheck`, `npm run lint`, `npm run build-prod`, and `git diff --check`.
- [ ] Run the Windows `npm run test:ui` suite per epic decision 8. In particular, `--area boards/lifecycle` covers explicit-path shortcut creation and overwrite refusal (`integration-test/tests/boards/lifecycle/lifecycle.test.mjs`); `--area core/scripting` exercises dialog-aware calls but its dialogs are renderer dialogs, not native-helper coverage. No existing `test:ui` native-dialog tracker test was found; do not claim these areas verify native title/cancel. Check Windows native file-dialog attention, title when available, and dismiss manually as well. No unit tests or harnesses.

### Live check (Claude)

**Results, 2026-11-25 (WSL Ubuntu 26.04):**

- **Board shortcut:**
  - `boards.createShortcut("/home/dev/walk/demo")` throws "Not available on Linux.", and no dialog opens.
  - The `$help` summary ends with "Not available on Linux."
- **Native dialog:** a native save dialog was opened with `app.fs.showSaveDialog(...)`. While it was open:
  - a window-routed call (`pages`) answered normally, with no buffer error. Its attention line read: "a native file
    dialog is open in window 0; native dialog cancellation is not available on this platform. Close the dialog
    manually."
  - `windows[0].nativeDialog` returned `{ open: true, kind: "file" }`.
  - `dismiss()` returned `{ cancelled: 0, titles: [], reason: "Native dialog cancellation is not available on this
    platform." }`.
- **Windows:** `boards/lifecycle` 12/12 (this covers creating a shortcut with an explicit path) and `core/scripting`
  6/6 pass.
- **Not run:**
  - the native-dialog title and `dismiss` on Windows, checked by hand;
  - a tracked message box on Linux.

- [ ] In WSL, open a tracked native file/folder dialog through a supported flow, then call a window-routed MCP path and `windows[i].nativeDialog` while it remains open. Confirm open/kind and attention without a title or buffer error; dismiss reports the limitation and does not claim to close a file picker. Close it manually and confirm state clears. Check a tracked message box too if a suitable flow is available.
- [ ] With a trusted board, call `boards.createShortcut` via script and MCP with and without an explicit `linkPath`; confirm `Not available on Linux.`, no Save dialog or shortcut, and the same reason in MCP `$help`. Confirm the board menu actions are hidden and voice-typing shortcut settings remain governed by their own feature.
- [ ] Confirm no snip helper is spawned during state, attention or dismissal. Linux `test:ui` launch is independently blocked by R-1 / US-2203; do not treat that as verification of this task.

## Concerns / Open questions

- None requiring a decision before implementation. `cancelled: 0` is deliberately a confirmed native-cancellation count; an abort signal is a request, not proof a message box closed. The optional reason communicates the limitation even when no controller is registered.
- A core gate happens after script-side argument/trust validation; malformed or untrusted input can therefore fail on validation first. All valid shortcut requests fail before a dialog on unsupported platforms. Direct internal IPC is not a public shortcut entry point and remains unchanged under the single-owner decision.
- Existing UI integration areas do not cover native helper inspection or cancellation; the Windows manual check and Claude's Linux live check cover that gap.

## Acceptance Criteria

- [ ] Off Windows no tracker state, attention or cancellation path reads a native handle or spawns the snip helper. Tracked open/kind remain visible; title is absent; dismissal aborts registered controllers and reports the limitation without claiming cancellation.
- [ ] Window-routed MCP calls and `windows[i].nativeDialog` remain usable with a tracked dialog open; attention gives actionable platform-appropriate guidance.
- [ ] Valid trusted `boards.createShortcut` script and MCP calls, with or without `linkPath`, fail with the shared availability reason before any dialog or shortcut work on Linux. MCP help reports it; board menu actions are hidden there. Voice-typing shortcut settings are unaffected.
- [ ] Windows shortcut creation, dialog inspection, attention and cancellation behavior remain unchanged. Typecheck, lint, Windows integration suite and the checks above pass; no new `process.platform` checks, tests or harnesses are added.
- [ ] The other native-handle reader is accounted for as described above; no unrelated port or `.desktop` launcher is implemented.

## Files Changed summary

| Path | Planned change |
|------|----------------|
| `src/main/native-dialog-tracker.ts` | Gate native helper paths, preserve tracked state, return honest cancellation and attention. |
| `src/main/mcp/ai-vision/main-root.ts` | Describe platform-specific dialog inspection and dismissal. |
| `src/renderer/editors/board/board-shortcut.ts` | Single execution gate using the feature table. |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Add availability to MCP help. |
| `src/renderer/editors/board/BoardEditorModel.ts`, `src/renderer/editors/board/BoardsSecondaryView.ts`, `src/renderer/editors/tools-hub/EditorsTreeView.ts` | Hide unavailable board shortcut menu actions. |
| `src/shared/platform.ts`, `src/shared/platform-features.ts` | No change: reuse predicates and feature table. |
| `src/main/virtual-desktop-manager.ts`, `src/main/board-window-identity.ts`, `src/ipc/main/window-handlers.ts`, `src/renderer/api/boards.ts` | No change: existing adapter guard, Windows implementation, IPC and validated call path. |
| `src/renderer/editors/settings/fields/ShortcutField.ts`, `src/renderer/editors/settings/sections/SettingsSections.ts` | No change: voice-typing shortcuts, unrelated to board shortcuts. |
| `snip-tool/src/main.rs`, `src/main/mcp/tools/call-tools.ts`, `integration-test/` | No change: reuse existing helper and routing; no new tests or harnesses. |
