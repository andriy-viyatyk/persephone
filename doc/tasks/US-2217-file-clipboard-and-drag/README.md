# US-2217: File clipboard, drag and drop, clipboard history

Epic: [EPIC-214](../../epics/EPIC-214.md). Status: Planned.

## Goal

Support Linux file clipboard and native drag interoperability, and focused clipboard history with clear Wayland limits, while preserving Windows behavior.

## Background

- `src/main/clip-service.ts` invokes the Windows snip helper for CF_HDROP and Preferred DropEffect; errors return empty/false. `src/main/os-drag-service.ts` filters existing paths, resolves an icon and calls `WebContents.startDrag`, but returns early outside Windows.
- `src/shared/platform-features.ts` already marks `clipboard.files`, `desktop.fileDragOut` and `clipboard.backgroundWatch` unavailable on Linux. The last remains unavailable: its Linux watcher is Phase 3.
- US-2212 observed native Wayland file clipboard and drag-in working, but writes without recent window input were silently dropped. Drag-out had no Linux implementation.
- The pinned `node_modules/electron/electron.d.ts` exposes asynchronous `clipboard.read()`, `write()`, `ClipboardItem` and `clear()`, but no `readBuffer`/`writeBuffer`. Electron 44's [clipboard API](https://www.electronjs.org/docs/latest/api/clipboard) and [ClipboardItem documentation](https://www.electronjs.org/docs/latest/api/clipboard-item) describe atomic multiple-format writes, native `text/uri-list`, and raw `electron application/osclipboard;format="..."` formats. These are API claims, not proof of GNOME Wayland interoperability. Earlier `writeBuffer` custom formats have been reported [pickled instead of native](https://github.com/electron/electron/issues/11838); the requested buffer methods cannot be used as-is with the installed version. Implement the documented raw key and have Claude verify publication and interoperability in the VM afterwards.
- `src/ipc/main/clipboard-handlers.ts` binds the existing typed file-list and drag endpoints. `src/renderer/components/tree-provider/os-clipboard.ts` calls them, uses `copyPathsInto` for copy/move and clears a fully consumed cut. `provider-item-controller.ts` cancels HTML drag before calling `startOsFileDrag`. `src/renderer/api/internal/GlobalEventService.ts` obtains native dropped file paths with `window.electron.getPathForFile` and has a drop-to-open fallback. US-2212 already saw drag-in pass.
- `src/main/clipboard-service.ts` owns history persistence, queueing, deduplication and status. `captureChange` relies on Windows watcher format IDs and metadata, and `startWatcher` runs the snip sidecar; the existing code cannot capture Linux history by merely enabling the setting. It stores file paths as CRLF and `parseFileListPayload` accepts LF. `isSamePath` already uses `resolvedPathCompareKey`, and tree paste uses `hrefCompareKey`: both use `pathsAreCaseInsensitive` from `src/shared/platform.ts`, so Linux preserves case. Format-name and legacy suffix lowercasing are not file identity comparisons; do not change them simply for WIN-16.
- `src/renderer/editors/settings/sections/ClipboardSection.ts`, `src/renderer/api/settings-schema.ts`, and `src/renderer/editors/settings/settings-catalog.ts` describe the opt-in setting; `src/renderer/scripting/ai-vision/namespaces/clipboard.ts` and `root.ts` describe it to MCP. `src/main/system-clipboard.ts` owns IPC text/image writes; `src/main/board-host/rpc/app.ts` independently writes board text/images. Neither checks whether a Wayland selection was actually accepted. `src/renderer/api/clipboard.ts` currently discards the write promise after logging failures. The only renderer call to `clipboardReadFilePaths` is in `pasteOsClipboardInto` in `src/renderer/components/tree-provider/os-clipboard.ts`; menu enablement does not read the payload.

## Implementation Plan

- [x] **File clipboard owner:** keep `src/main/clip-service.ts` as the platform dispatch and public `readClipboardFiles` / `writeClipboardFiles` owner. Move the existing helper implementation unchanged into `src/main/clip-service-windows.ts` and add `src/main/clip-service-linux.ts` for Linux. Select with `isWindows`/`isLinux` from `src/shared/platform.ts`; preserve empty/false behavior for unsupported OSes and the current Windows helper, error handling and `ClipboardFileList` contract. Use the existing typed `src/ipc/contracts/clipboard.ts` and `src/ipc/main/clipboard-handlers.ts` boundary; no new transport.
- [x] **Linux formats:** the Linux collaborator owns URI conversion and cut interpretation, reusing Node `pathToFileURL` and `fileURLToPath` and Electron `clipboard.read`/`write`/`ClipboardItem`. Write one atomic item with `text/uri-list` (CRLF-separated absolute file URIs) and raw `x-special/gnome-copied-files` (`copy` or `cut`, newline, URI lines; no trailing newline). Read GNOME format first to preserve cut; otherwise read URI list as copy. Handle CRLF/LF, comments and blank lines, percent encoding, Unicode, spaces and local file URLs; reject malformed, non-file or remote-host entries instead of turning them into local paths. Empty paths clear via `clipboard.clear()`. Preserve the boolean contract: true when Electron's write resolves, false on failure. The paste endpoint reads file payloads only in response to the existing user paste, including the comparison immediately before consuming a cut; never call it on focus, menu open or status checks. Focused history has its own explicitly scoped polling reads. No renderer currently reads files to enable Paste, so no `clipboard.has()` check or new IPC is needed. In `os-clipboard.ts`, compare the original and current file list and effect before clearing a successfully consumed Linux cut; retain the existing Windows clear behavior.
- [x] **Drag:** `src/main/os-drag-service.ts` keeps filtering existing files, `resolveIcon`, fallback icon and sender `startDrag` as its owner. Add `src/main/os-drag-service-linux.ts` as the Linux-specific collaborator for native drag invocation; dispatch via shared platform helpers, preserving the Windows path and arguments. Reuse the filtered paths/icon and existing IPC, retain multi-selection and drag timing; do not cancel the renderer drag for unsupported platforms (`provider-item-controller.ts` uses `getPlatformFeature("desktop.fileDragOut")` before `preventDefault`). Leave inbound `GlobalEventService` and its trait/fallback flow intact unless VM findings record a specific defect. Remove the corresponding `process.platform` baseline entry in `eslint.config.mjs` when the direct use is removed.
- [x] **Focused history:** add `src/main/clipboard-history-linux.ts` beside `clipboard-service.ts` as the owner of a focus-scoped observation lifecycle. While history is enabled and a Persephone `BrowserWindow` is focused, poll at a fixed interval with no overlapping reads. Define one interval constant in a commented tuning-constants block at the top of the collaborator (for example, 1000 ms). The first sample after focus is gained or history is enabled is a baseline only and is never recorded, so a selection copied in another app is not imported on refocus. Stop on blur, disable, restart and shutdown; discard reads completing after blur or another lifecycle change, including across rapid refocus. Deduplicate unchanged samples; recognize text, HTML, PNG and file lists via Electron types and the Linux file clipboard collaborator. This is focused sampling, not a Linux background watcher; polling can miss intermediate changes. Clean up timers/listeners. Do not fabricate Windows format IDs or exclusion metadata: refactor `clipboard-service.ts` to share a platform-neutral payload persistence function extracted from `captureChange`, reusing its existing queue, staging, hashing, trimming, broadcast and restore logic. Keep the Windows watcher, privacy exclusions, health pings and event path unchanged. Linux reports an honest running/disabled/error status through existing `ClipboardStatus` and never reports Windows watcher health or starts the sidecar; disable ping/restart sidecar operations for the Linux collaborator. Do not promise Windows-only exclusion formats on Linux; preserve the existing disk-readable warning.
- [x] **Feature data and wording:** `src/shared/platform-features.ts` owns availability: set Linux `clipboard.files` and `desktop.fileDragOut` available only with the implementations above; leave `clipboard.backgroundWatch` unavailable. `src/renderer/editors/settings/sections/ClipboardSection.ts` uses `getPlatformFeature` to show a localized focused-only explanation when background watching is unavailable, while retaining the existing warning and Windows wording. Update `src/renderer/api/settings-schema.ts` comments and `src/renderer/editors/settings/settings-catalog.ts` discovery text for Linux, and `src/renderer/scripting/ai-vision/namespaces/clipboard.ts` / `root.ts` MCP `$help` summaries to explain focused sampling and no background history. Add one sentence to the clipboard `$help` in `namespaces/clipboard.ts`: "On Wayland, a clipboard write made without recent user input to a Persephone window may be dropped by the compositor." Add English strings in `src/shared/i18n/en/settings.ts`; translate all packs at epic completion. Keep the feature usable while focused; do not hide the history panel just because background watching is unavailable. Update `assets/guides/screens/settings.md` and `assets/guides/tabs-and-navigation/menu-bar.md` to explain the focused-only Linux behavior, preserving Windows descriptions.

### Representative changes

```ts
// src/main/clip-service.ts: before
const child = spawn(getSnipToolPath(), ["clipboard-read"], { /* ... */ });
// after: dispatch from the owner; Windows collaborator retains the existing spawn implementation
if (isLinux) return readLinuxClipboardFiles();
if (isWindows) return readWindowsClipboardFiles();
return EMPTY;
```

The installed `ClipboardItem` constructor accepts `string`, `Blob`, `ClipboardBookmark`, or a `Promise<string | Blob>`; `Buffer` is not in its declared value types. Use strings or Blobs for these MIME payloads, not a Buffer.

```ts
// src/main/clip-service.ts: before (Windows helper; no Linux format write)
const args = cut ? ["clipboard-write", "--cut"] : ["clipboard-write"];
// src/main/clip-service-linux.ts: after (representative; paths are absolute)
const uris = paths.map((filePath) => pathToFileURL(filePath).href);
await clipboard.write([new ClipboardItem({
    "text/uri-list": uris.join("\r\n"),
    'electron application/osclipboard;format="x-special/gnome-copied-files"':
        [cut ? "cut" : "copy", ...uris].join("\n"),
})]);
return true;
```

```ts
// src/renderer/components/tree-provider/os-clipboard.ts: before, after successful move
await api.clipboardWriteFilePaths([], false);
// after: Windows keeps its existing clear; Linux clears only the same cut selection
const current = isLinux ? await api.clipboardReadFilePaths() : clip;
if (!isLinux || (current.dropEffect === clip.dropEffect &&
    current.paths.length === clip.paths.length &&
    current.paths.every((path, index) => path === clip.paths[index]))) {
    await api.clipboardWriteFilePaths([], false);
}
```

```ts
// src/main/os-drag-service.ts: before
if (process.platform !== "win32") return;
// after: keep existing filtering and icon resolution; select the platform collaborator
if (!isWindows && !isLinux) return;
```

```ts
// src/renderer/editors/settings/sections/ClipboardSection.ts: before
// only the readable-on-disk warning is shown
// after: additionally explain focused-only history when the background feature is unavailable
if (!getPlatformFeature("clipboard.backgroundWatch").available) { /* localized explanation */ }
```

### Verification required of implementation

Run `npm run typecheck`, `npm run lint`, and keep Linux CI green. If guides change, run `npm run guides:check`. Run existing Windows `test:ui` areas `tools/clipboard`, `sidebar/explorer`, `editors/folder`, `core/settings` and `shell/menus`; do not add unit tests or test harnesses. Claude owns live checks below.

## Concerns / Open questions

- **Electron format and selection semantics:** `writeBuffer`/`readBuffer` are absent from the installed Electron 44 types; use the replacement above. Claude verifies actual raw GNOME publication, simultaneous MIME availability and cut semantics after implementation and reports any limitation.
- **Wayland input:** On Wayland, a clipboard write made without recent user input to a Persephone window may be dropped by the compositor.
- **Sampling limits:** Focus-gated polling can miss rapid changes and a copy made before the first baseline sample; it must not store the clipboard copied in another app upon refocus. Linux has no Windows privacy metadata guarantee. Settings and MCP help must say this; the Phase 3 background backend is out of scope.
- **Guardrails:** no new protocol or board rule; use existing typed service channels. No growth in roadmap §2.3 god files: extract reusable persistence from `clipboard-service.ts` to a focused collaborator so that file shrinks overall. No `await import()` or wrapper to evade import zones. Any change to `window.persephone` requires a `BOARD_BRIDGE_VERSION` bump and history line. Strict-folder null-check fixes are type-only unless explicitly recorded as behavior changes. Do not add direct `process.platform` checks; the allowlist only shrinks.

### Claude's VM checks (not implementation steps)

On Ubuntu 26.04 GNOME Wayland with Electron native Wayland, execute checklist rows 20–23. With real input, paste into Files and inspect the file system to verify copy and cut; inspect advertised native MIME names and payload bytes for both formats, verify simultaneous availability and reading in both directions with Files, including multiple files/folders, spaces, Unicode, percent characters and case-distinct names. Report if the GNOME format is not published. Verify moves occur once and failures do not consume a cut; check the destination is not overwritten without confirmation. Verify drag to Files and desktop and drag in to tabs and trait targets, including multiple files and icon/gesture timing. Enable history and check text, HTML, image and file copy while focused, disabling/restarting and focus transitions; ensure no reads occur in the background and the baseline selection is not stored on refocus or enable. Document any API or compositor limitation; do not treat promise resolution alone as proof of interoperability.

## Acceptance Criteria

- Linux file copy/cut/paste interoperates with Files in both directions using the native URI and GNOME formats; cut moves and errors are reported without falsely consuming a new selection.
- Native drag-out works to Files and desktop, drag-in retains existing open/trait behavior, and Windows behavior stays unchanged.
- Opt-in history records supported focused copies, does not read in the background or capture an unrelated selection on refocus, and correctly manages status and lifecycle. Settings and MCP explain its limits and existing disk privacy warning remains.
- Clipboard MCP help warns that a Wayland write without recent input may be dropped. Case-distinct Linux paths remain distinct.
- Feature data, verification and translation deferral follow the plan; Claude records VM results. Windows helper, watcher behavior and feature semantics remain unchanged.

## Files Changed

| Path | Planned change |
|------|----------------|
| `src/main/clip-service.ts`, `src/main/clip-service-windows.ts`, `src/main/clip-service-linux.ts` | Dispatch and platform-specific file clipboard |
| `src/main/os-drag-service.ts`, `src/main/os-drag-service-linux.ts`, `src/renderer/components/tree-provider/provider-item-controller.ts`, `eslint.config.mjs` | Native Linux drag and availability gate |
| `src/main/clipboard-service.ts`, `src/main/clipboard-history-linux.ts` | Focused history lifecycle and shared persistence |
| `src/renderer/components/tree-provider/os-clipboard.ts` | Preserve a newer Linux selection after cut paste |
| `src/shared/platform-features.ts`, `src/renderer/editors/settings/sections/ClipboardSection.ts`, `src/renderer/api/settings-schema.ts`, `src/renderer/editors/settings/settings-catalog.ts`, `src/shared/i18n/en/settings.ts` | Availability and focused-only settings explanation |
| `src/renderer/scripting/ai-vision/namespaces/clipboard.ts`, `src/renderer/scripting/ai-vision/root.ts` | MCP history limitations |
| `assets/guides/screens/settings.md`, `assets/guides/tabs-and-navigation/menu-bar.md` | Explain focused-only Linux history |

**No changes planned:** `src/main/system-clipboard.ts`, `src/main/board-host/rpc/app.ts`, `snip-tool/src/clipboard.rs`, `src/ipc/contracts/clipboard.ts`, `src/ipc/main/clipboard-handlers.ts`, `src/renderer/api/internal/GlobalEventService.ts`, `src/shared/path-containment.ts`, board bridge and registries, `integration-test/`. Existing Windows code, typed endpoints, drop flow and path identity helpers remain in use.

## VM results (Claude, 2026-11-26)

Ubuntu 26.04, GNOME Wayland, Electron native Wayland, dev build; real input through ydotool. Checks used test files
only and never read clipboard contents directly: results were checked on disk and in Persephone's stored history.

| Row | Check | Result |
|-----|-------|--------|
| 20 | Copy Persephone → Files, Files → Persephone | **Pass.** Copying `a b.txt`, `Ünïcode 100%.txt`, `Case.txt` + `case.txt` and a folder in Persephone, then Ctrl+V in Files, creates all five (case-distinct names stay distinct, folder contents included). Ctrl+A, Ctrl+C in Files, then paste into a Persephone folder target copies both files; sources stay. |
| 21 | Cut in both directions | **Pass.** Cut in Persephone + paste in Files moves the file (source gone). Cut in Files + paste in Persephone moves it. |
| 22 | Drag and drop | **Pass.** Dragging a sidebar file from Persephone to the desktop (DING) copies it to `~/Desktop`; dragging one into a Files window copies it there. Dragging a desktop file into Persephone opens it as a tab. |
| 23 | Focused history | **Pass.** With history enabled, the current clipboard is not imported (count 0); a Ctrl+C inside Persephone is recorded; a copy made in Files followed by refocusing Persephone is not imported. The setting comment states the Linux limits. |
