# US-2199: Platform layer

**Epic:** [EPIC-212](../../epics/EPIC-212.md) · **Status:** Implemented (unreviewed)

## Goal

Define a shared platform identity and one authoritative feature-availability table, and prevent new scattered platform checks. Preserve Windows behavior and leave platform ports and startup fixes to their owning tasks.

## Background

[EPIC-212](../../epics/EPIC-212.md) decisions 2, 3, 4, 5 and 8 govern this work. [US-2198](../US-2198-linux-dev-environment/README.md) found the Windows-shaped pipe creates a literal socket filename on Linux (F6), POSIX file opening needs WIN-22 (F5), and Electron already supplies the data path (F7). US-2200 owns these fixes and helper detection. No Linux launcher is planned; Electron's single-instance mechanism owns handoff. macOS has a distinct slot but no supported build.

### Design and ownership

`src/shared/platform.ts` will own identity and predicates, not Electron, filesystem probes, or mutable availability. Electron enables Node integration in `src/main/open-window.ts:102`; a static shared import is legal in the relevant main, IPC, renderer and preload zones (`eslint.config.mjs:612`, `:834`). Do not import the renderer API from `src/renderer/uikit/`: its zone at `eslint.config.mjs:630` excludes `src/shared`; no UIKit change is needed. `process.platform` may also be a Node value outside the three supported OSes: preserve its exact value for existing comparisons instead of mapping an unknown OS to Linux. Expose a typed supported-platform slot (`win32`, `linux`, `darwin`, or `undefined` for unsupported) and `isWindows`, `isLinux`, `isMac` predicates; unsupported OSes get unavailable entries with an explicit reason. Do not treat `darwin` as Linux. `isWindows` and `isMac` must remain exact comparisons, including on unsupported platforms.

`src/shared/platform-features.ts` owns the **single** typed feature ID registry, static per-platform matrix and result shape. Main and renderer import the same pure module directly: Electron enables Node integration and both processes have the same `process.platform`. All readers use the single accessor `getPlatformFeature(id): FeatureAvailability`; they do not inspect the matrix or choose a platform themselves. Each result is `{ available: true }` or `{ available: false, reason: string }`. A shared `unavailableReason(platform)` builds English reasons for MCP help and errors, for example `Not available on Linux.` UI consumers hide unavailable features; no i18n catalog entries are added.

US-2199 adds no probes or runtime overrides. US-2200 owns missing-helper detection and the design, transport and propagation of runtime overrides behind the same accessor, including main/renderer consistency and any updates to mounted consumers. Do not claim a helper is missing until detected. Platform support does not guarantee that a binary exists. No IPC or startup loading is needed for this static matrix. No `window.persephone` change is planned; if a later change modifies it, bump `src/shared/board-bridge-version.ts` `BOARD_BRIDGE_VERSION` and add a history line.

### Feature inventory and phase ownership

The table describes current implementation, not the intended parity target. W = available on Windows as today, L/D = unavailable on Linux/macOS unless stated otherwise. `darwin` is deliberately conservative, not an assertion that macOS has been tested. Unavailable reasons name the current OS; these are separate capabilities when only one part is missing.

| Feature ID | Evidence and current availability | Remaining owner and consumers |
|---|---|---|
| `terminal.launch` | W; L/D no: `src/main/terminal-launcher.ts:31,56` skips non-Windows. | US-2199: folder menus `src/renderer/ui/sidebar/menu-bar-folder-ui.ts:81` and `src/renderer/components/tree-provider/item-menus.ts:194`; phase 2: terminal detection, `src/renderer/api/terminal.ts` and settings `src/renderer/editors/settings/sections/SettingsSections.ts:364`. |
| `desktop.fileAssociations` | W installer; L/D no current integration: `build/installer.nsh:427,438`, `electron-builder.yml:96`. | Phase 4 installer/MIME; Open with is not synonymous with the pipe. |
| `desktop.defaultBrowser` | W; L/D no: `src/main/browser-registration.ts:12,71,82,137`. | Phase 2; `src/renderer/editors/settings/sections/DefaultBrowserSection.ts:55`. |
| `desktop.boardShortcut` | W; L/D no: `src/main/board-window-identity.ts:92,118,126`. | Phase 2; `src/renderer/api/boards.ts:230`. |
| `screen.snip` | W; L/D no: `src/main/snip-service.ts:9,30` resolves and launches a Windows executable. | US-2199: quick-settings snip rows, `shell.$help` and `shell.startScreenSnip`; US-2200: binary detection; phase 3: portal capture. |
| `memory.mnemeSidecar` | W; L/D no current executable: `src/main/mneme-service.ts:37,39`. | US-2200: missing binary; phase 3: native sidecar; `src/renderer/ui/app/HeaderQuickSettingsPopover.ts:31`, `src/renderer/editors/settings/sections/McpSection.ts:150`, `src/renderer/api/app-startup.ts:261`. Do not disable a separately configured remote MCP server. |
| `desktop.virtualPlacement` | W; L/D no: `src/main/virtual-desktop-manager.ts:154,187`, `src/main/test-mode/controller.ts:35`. | Phase 2: explicitly not offered on Wayland; test-mode calls and `--desktop`. |
| `browser.windowsSso` | W; L/D no: `src/main/windows-sso.ts:54`. | Phase 2 settings visibility `src/renderer/editors/settings/sections/BrowserProfilesSection.ts:520`; no promise of Linux equivalent. |
| `media.vlcAutoDetect` | W; L/D no current detection: `src/main/vlc-launcher.ts:4,23`. | Phase 2 auto-detection and settings `SettingsSections.ts:329`. A configured VLC path remains usable; do not gate VLC as a whole. |
| `desktop.tray` / `desktop.closeToTray` | W; L/D no **guaranteed** tray: `src/main/tray-setup.ts:12`, default in `src/renderer/api/settings-schema.ts:52`. Availability is conservative pending actual desktop detection, not a claim Electron has no Linux tray API. | Phase 2: detection and safe close fallback; US-2201 investigates F10; `SettingsSections.ts:76`. |
| `clipboard.files` / `clipboard.backgroundWatch` | W; L/D no current helper: `src/main/clip-service.ts:15,59,78`, `src/main/clipboard-service.ts:267,764`. | Phase 2 file clipboard and foreground/history limitations; phase 3 watcher; ordinary text clipboard is separate. |
| `desktop.fileDragOut` | W; L/D no: `src/main/os-drag-service.ts:24`. | Phase 2; drag-in is separate. |
| `audio.computerCapture` / `audio.computerCancellation` | W; L/D no: `src/main/audio-service.ts:356,357`, `src/renderer/audio/CaptureSourcePool.ts:205`. | Phase 3; transcript choices `src/renderer/editors/monaco/contributions/transcript/TranscriptToolbarContributionView.ts:35` and `TranscriptController.ts:46`; microphone remains separate. |
| `speech.windowsVoiceTyping` | W; L/D no current route: `src/ipc/main/voice-typing-handlers.ts:22`, `src/shared/voice-typing-shortcut.ts:10`. | Phase 2 shortcut/settings work and later speech-provider parity; do not conflate with Chromium microphone. |

WIN-1/2/4/5/12/13/21 security policy/22–29/31/35–38 are packaging, path, policy, behavior or validation work rather than individual offered binary features; retain their owners in roadmap phases 1–4 and US-2200, and do not mark entire editors, update checks, browser grants, clipboard text, notifications or app startup unavailable. WIN-33 is the shared snip helper behind several IDs, not a separate user feature; WIN-34 is Mneme. WIN-30 chrome is unverified, not declared missing. Tor has no current auto-detection on any platform; configured Tor remains usable. VLC discovery and configured execution remain distinct. The launcher pipe is internal transport (US-2200), the console wrapper is a packaging/runner detail (phases 1 and 4), and Mark-of-the-Web is download behavior (phase 4 documentation), not offered features. Windows availability is platform support, not a guarantee of installation, tray presence or successful execution.

### Existing platform checks (baseline)

The following is the complete text-search baseline in `src/` and `scripts/` for `process.platform` (including `globalThis.process.platform`), `os.platform()` and `os.type()`; no `os` calls were found. Lines are a dated inventory, not stable identifiers. `scripts/dev-mneme-model.mjs` is recorded for completeness but remains outside the ESLint rule: the existing global script ignores stay unchanged. The 46 listed checks include 44 under `src/` and two in the script.

```text
scripts\dev-mneme-model.mjs:23:    if (process.platform === "win32") {
scripts\dev-mneme-model.mjs:26:    if (process.platform === "darwin") {
src\main\board-log.ts:22:    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
src\main\board-host\rpc\watch.ts:21:    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
src\test-host\test-identity.ts:7:    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
src\main\board-host\rpc\files.ts:69:    const flags = process.platform === "win32" ? "i" : "";
src\renderer\core\utils\file-path.ts:261:    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
src\main\board-file-access.ts:43:                    process.platform === "win32" ? normalizeWindowsComponents(requested) : requested,
src\main\board-file-access.ts:46:                    process.platform === "win32" ? normalizeWindowsComponents(hostedPath) : hostedPath,
src\main\board-file-access.ts:241:                    const canonical = await realpathNative(process.platform === "win32" ? normalizeWindowsComponents(value) : value);
src\main\board-file-access.ts:283:    const normalized = process.platform === "win32" ? normalizeWindowsComponents(value) : path.normalize(value);
src\main\audio-service.ts:356:        if (argument.source === "computer" && process.platform !== "win32") throw codedError("no-handler", "Computer audio capture is supported on Windows only.");
src\main\audio-service.ts:357:        if (argument.cancelComputerAudio === true && process.platform !== "win32") throw codedError("no-handler", "Computer audio cancellation is supported on Windows only.");
src\main\board-root-hashes.ts:15:    return sha256Hex(`bundled:${process.platform === "win32" ? bundledId.toLowerCase() : bundledId}`);
src\test-host\launcher.ts:51:    if (process.platform === "win32") {
src\main\windows-sso.ts:54:    if (!enabled || process.platform !== "win32") return false;
src\main\windows-env.ts:33:    if (process.platform !== "win32") return;
src\ipc\main\voice-typing-handlers.ts:22:            if (process.platform !== "win32") throw new Error("permission-denied");
src\main\main-setup.ts:84:        if (process.platform !== "darwin") {
src\main\command-runner.ts:116:    if (process.platform === "win32") {
src\main\command-runner.ts:234:            detached: process.platform !== "win32",
src\main\virtual-desktop-manager.ts:154:        if (process.platform !== "win32") throw new Error("Virtual desktop selection is supported only on Windows.");
src\main\virtual-desktop-manager.ts:187:        if (process.platform !== "win32") throw new Error("Virtual desktop APIs are supported only on Windows.");
src\main\download-service.ts:106:    if (process.platform !== "win32") return;
src\main\utils.ts:12:    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
src\main\path-watch-service.ts:134:    return { path: normalized, key: process.platform === "win32" ? normalized.toLowerCase() : normalized };
src\main\os-drag-service.ts:24:    if (process.platform !== "win32") return;
src\main\site-extension-trust-service.ts:14:    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
src\main\one-shot-frame-grant.ts:35:        if (this.options.platform && process.platform !== this.options.platform) return;
src\main\open-windows.ts:319:        if (isLastWindow && canQuit && process.platform !== "darwin") this.doQuit = true;
src\main\permission-policy-service.ts:196:            const isTranscriptDisplay = permission === "media" && types.length === 0 && process.platform === "win32"
src\main\permission-policy-service.ts:198:            const isAudioWindowDisplay = permission === "media" && types.length === 0 && process.platform === "win32"
src\main\permission-policy-service.ts:267:        if (process.platform !== "win32" || !request.videoRequested || !request.audioRequested || (!transcriptGrant && !audioGrant)) {
src\main\module-service\record.ts:71:    if (globalThis.process.platform !== "win32" || !pid) return;
src\main\terminal-launcher.ts:31:    if (process.platform !== "win32") return;
src\main\test-mode\controller.ts:35:            if (process.platform !== "win32") throw new Error("--desktop is supported only on Windows.");
src\main\test-mode\desktop-placement.ts:54:        if (process.platform === "win32") desktopAwareness.setVirtualDesktopProbe({
src\renderer\api\ts-project-files.ts:45:    return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "");
src\renderer\api\speech\MicrophoneCapture.ts:44:            echoCancellation: process.platform !== "win32",
src\renderer\api\speech\MicrophoneCapture.ts:45:            noiseSuppression: !(settings.get("microphone.clean") || process.platform === "win32"),
src\renderer\api\speech\MicrophoneCapture.ts:99:                referenceAcquire: process.platform === "win32"
src\renderer\audio\CaptureSourcePool.ts:205:            if (process.platform !== "win32") throw new Error("Computer audio capture is supported on Windows only.");
src\renderer\components\roots-tree-build.ts:29:    return process.platform === "win32" ? segment.toLowerCase() : segment;
src\renderer\editors\monaco\contributions\transcript\TranscriptToolbarContributionView.ts:35:            { id: "transcript-mode-both", label: t("transcript.both"), onClick: () => this.start("both"), disabled: process.platform !== "win32" },
src\renderer\editors\monaco\contributions\transcript\TranscriptToolbarContributionView.ts:36:            { id: "transcript-mode-computer-audio", label: t("transcript.computerAudio"), onClick: () => this.start("computer"), disabled: process.platform !== "win32" },
src\renderer\editors\monaco\contributions\transcript\TranscriptController.ts:46:        if (source !== "microphone" && process.platform !== "win32") return;
```

## Implementation Plan

- [x] Add `src/shared/platform.ts` with the raw platform value, supported-platform narrowing and exact `isWindows`, `isLinux`, `isMac` predicates. Export `pathsAreCaseInsensitive = isWindows` for the current behavior; macOS can decide its own value in its later port. No Electron, IPC, environment paths or helper probes. Replace the following 11 Windows checks with that predicate without changing their surrounding operations:

  | File and existing function | Path-derived rule |
  |---|---|
  | `src/main/board-log.ts:22` `normalizePath` | Case-folds the resolved log path for its queue key. |
  | `src/main/board-host/rpc/watch.ts:21` `normalizeWatchPath` | Case-folds watched paths for scope comparisons. |
  | `src/test-host/test-identity.ts:7` `normalizeTestFile` | Case-folds a test file path for identity. |
  | `src/main/board-host/rpc/files.ts:69` `folderMaskMatches` | Applies the same filesystem case rule to basename mask matching. |
  | `src/renderer/core/utils/file-path.ts:261` `fpNormalizeForCompare` | Case-folds resolved paths for equality. |
  | `src/main/board-root-hashes.ts:15` `bundledBoardDigest` | Preserves historical Windows folding of a bundled board folder name before hashing its storage identity. `src/main/bundled-boards.ts` `bundledBoardId` derives it from `BoardRoot.bundledId` in `src/shared/board/board-root.ts`. |
  | `src/main/utils.ts:12` `comparePathKey` | Case-folds a resolved path comparison key. |
  | `src/main/path-watch-service.ts:134` `normalizePath` | Case-folds the watch key, retaining the display path. |
  | `src/main/site-extension-trust-service.ts:14` `folderKey` | Case-folds a resolved folder trust identity. |
  | `src/renderer/components/roots-tree-build.ts:29` `normSeg` | Case-folds tree path segments used as keys. |
  | `src/renderer/api/ts-project-files.ts:45` `compileTsGlob` | Applies the same filesystem case rule to path-glob matching. |

  The two regex cases match path names rather than literally constructing keys; they follow the same Windows filesystem case policy. The bundled ID is path-derived, though its hash is a historical storage identity; keep the exact inputs and hash. All 11 import `src/shared/platform.ts` legally: `coreBoundary` explicitly permits shared, the component and API zones do not prohibit it, and no configured main or test-host zone blocks it (`eslint.config.mjs:596, :660, :804 and :920`). No UIKit import is involved. Preserve all normalization, glob flags, storage keys and Windows behavior. Leave the unrelated platform checks allowlisted.

  ```ts
  // Before (src/main/board-log.ts)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  // After
  return pathsAreCaseInsensitive ? resolved.toLowerCase() : resolved;
  ```

- [x] Add `src/shared/platform-features.ts` with the IDs and three-platform matrix above, explicit conservative unsupported-OS results, `FeatureAvailability`, and the only read path `getPlatformFeature(id)`. Use one shared English `unavailableReason(platform)` for unavailable entries. Import platform identity directly from `src/shared/platform.ts`; do not expose a mutable table or add runtime checks, IPC, renderer loaders or a main snapshot. The feature operation remains with its existing owner, such as `terminal-launcher.ts` or `snip-service.ts`.

  ```ts
  // Before: no common feature contract.
  // After: all consumers use the same accessor and result shape.
  type FeatureAvailability = { available: true } | { available: false; reason: string };
  getPlatformFeature("screen.snip");
  ```

- [x] Wire a small representative set. In `src/renderer/ui/sidebar/menu-bar-folder-ui.ts` `genericMenu` and `src/renderer/components/tree-provider/item-menus.ts` `getFolderMenuItems`, omit only the `open-terminal-here` entry when `getPlatformFeature("terminal.launch").available` is false, preserving other items and Windows order. In `src/renderer/ui/app/HeaderQuickSettingsPopover.ts` `onMount`, omit both snip rows when `screen.snip` is unavailable; retain the record row, separator, other switches and focus behavior. In `src/renderer/editors/settings/sections/McpSection.ts`, hide the Mneme header, switch, port and status when `memory.mnemeSidecar` is unavailable; retain MCP settings, do not mutate persisted values or remove independently configured MCP servers. Keep model subscriptions and cleanup valid when rows are absent. Hide the Mneme quick-settings switch without changing its stored value. Later phases own the other consumers listed above.

  ```ts
  // Before (genericMenu): terminal item is always in the array.
  { id: "open-terminal-here", /* existing item */ }
  // After: retain the existing item and action only when available.
  ...(getPlatformFeature("terminal.launch").available ? [terminalItem] : [])
  ```

- [x] In `src/renderer/scripting/ai-vision/namespaces/shell.ts`, have `describeShell` build the `startScreenSnip` member summary/help using the accessor and append the English unavailable reason while retaining the method description. Snip uses `ClipboardApi` (`src/ipc/contracts/clipboard.ts:19`), not `ShellApi`: in `src/ipc/main/clipboard-handlers.ts:31`, check `getPlatformFeature("screen.snip")` immediately before calling `src/main/snip-service.ts`, and throw `Error(reason)` when unavailable. The existing endpoint carries the error to `src/renderer/api/shell/shell-calls.ts` and `src/renderer/api/shell/index.ts`, through which MCP invokes the method. Keep the Windows call unchanged, including null on cancellation. Do not guard screenshot, recording or other clipboard operations. Later feature owners extend their own help and call entry points.

  ```ts
  // Before: startScreenSnip: async (_event, hideWindows) => startScreenSnip(hideWindows)
  // After, inside the existing ClipboardApi handler:
  const availability = getPlatformFeature("screen.snip");
  if (!availability.available) throw new Error(availability.reason);
  return startScreenSnip(hideWindows);
  ```

- [x] Add a small local ESLint rule in `eslint.config.mjs`, registered beside `vanilla-view` at `:704` and scoped to `src/**`. Count direct `process.platform`, `globalThis.process.platform`, and `os.platform()` member/call expressions once per occurrence. Exempt `src/shared/platform.ts` and, if it directly reads the platform, `src/shared/platform-features.ts`; explicitly named per-platform collaborator files may be added when created. The per-file maximum-occurrence allowlist below is the baseline **after** the 11 migrations. The default maximum is zero. Report occurrences above each file's maximum, with a config comment that the counts only shrink. A count limit prevents adding another occurrence to an already allowlisted file, although it does not distinguish replacement of one existing occurrence with another. Keep the current global script ignores unchanged; the two script checks are inventory only. Do not add fingerprint, alias, destructuring or computed-property analysis. `os.type()` is present in the baseline search but is outside this rule's requested matcher.

  ```js
  // Existing checks only; these counts only shrink.
  const existingPlatformChecks = {
      "src/ipc/main/voice-typing-handlers.ts": 1,
      "src/main/audio-service.ts": 2,
      "src/main/board-file-access.ts": 4,
      "src/main/command-runner.ts": 2,
      "src/main/download-service.ts": 1,
      "src/main/main-setup.ts": 1,
      "src/main/module-service/record.ts": 1,
      "src/main/one-shot-frame-grant.ts": 1,
      "src/main/open-windows.ts": 1,
      "src/main/os-drag-service.ts": 1,
      "src/main/permission-policy-service.ts": 3,
      "src/main/terminal-launcher.ts": 1,
      "src/main/test-mode/controller.ts": 1,
      "src/main/test-mode/desktop-placement.ts": 1,
      "src/main/virtual-desktop-manager.ts": 2,
      "src/main/windows-env.ts": 1,
      "src/main/windows-sso.ts": 1,
      "src/renderer/api/speech/MicrophoneCapture.ts": 3,
      "src/renderer/audio/CaptureSourcePool.ts": 1,
      "src/renderer/editors/monaco/contributions/transcript/TranscriptController.ts": 1,
      "src/renderer/editors/monaco/contributions/transcript/TranscriptToolbarContributionView.ts": 2,
      "src/test-host/launcher.ts": 1,
  };
  ```

- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. Claude owns the live checks, including Windows behavior and the Windows integration suite, under epic decisions 7 and 8. Do not implement startup-blocker fixes or helper detection here.

## Concerns

- This is representative plumbing: the deferred UI, settings, script and MCP consumers in the feature table are not yet uniformly hidden or rejected. Their phase owners must complete that before parity/release. US-2200 owns startup/helper fixes and future runtime overrides.
- `desktop.tray` and `desktop.closeToTray` express conservative availability for offering those features, not a reliable probe. Hiding a setting does not prevent the existing close-to-tray default; phase 2 owns safe behavior and US-2201 investigates it.
- The accessor initially reads static platform data identically in both processes. US-2200 must decide how main-owned runtime conditions reach other processes and update already mounted consumers while keeping this accessor stable. macOS and unsupported platforms remain distinct.
- Preserve Windows behavior, including existing errors, cancellation, path identities and settings values. Nullability fixes in strict folders change types only. Do not add async imports or wrappers to bypass import zones.

## Acceptance Criteria

- [x] Pure shared identity handles Windows, Linux, macOS and unknown Node platforms without falsely mapping the latter; Windows and macOS predicates preserve exact comparisons.
- [x] One typed table covers the offered platform-specific capabilities and distinguishes configured VLC from auto-detection. All readers use `getPlatformFeature(id)` and receive an English reason for unavailable features.
- [x] Main and renderer import the static table directly; no feature snapshot, new IPC endpoint, startup loader or `window.persephone` property. Representative terminal menus, snip actions, Mneme settings and quick settings follow the accessor; snip MCP help and calls explain unavailability and preserve Windows behavior.
- [x] All 11 path-derived case comparisons above use `pathsAreCaseInsensitive` with identical Windows behavior. The `src/**` local ESLint rule enforces the shrinking per-file count baseline; scripts retain their existing lint scope.
- [x] `npm run typecheck` and `npm run lint` pass; Claude owns live checks and the Windows integration suite. No helper detection, startup-blocker fixes or other WIN ports are included.
- [x] No APPDATA/LOCALAPPDATA-based data-folder logic, Linux launcher or other platform behavior changes are added.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/platform.ts`, `src/shared/platform-features.ts` | Pure platform identity, path-case predicate and single static availability registry/accessor. |
| `src/ipc/main/clipboard-handlers.ts` | Guard the existing `ClipboardApi` snip handler using the shared accessor. |
| `src/renderer/ui/sidebar/menu-bar-folder-ui.ts`, `src/renderer/components/tree-provider/item-menus.ts`, `src/renderer/ui/app/HeaderQuickSettingsPopover.ts`, `src/renderer/editors/settings/sections/McpSection.ts` | Representative feature visibility. |
| `src/renderer/scripting/ai-vision/namespaces/shell.ts` | Snip help reflects availability. |
| `src/main/board-log.ts`, `src/main/board-host/rpc/watch.ts`, `src/test-host/test-identity.ts`, `src/main/board-host/rpc/files.ts`, `src/renderer/core/utils/file-path.ts`, `src/main/board-root-hashes.ts`, `src/main/utils.ts`, `src/main/path-watch-service.ts`, `src/main/site-extension-trust-service.ts`, `src/renderer/components/roots-tree-build.ts`, `src/renderer/api/ts-project-files.ts` | Eleven path-derived case-rule migrations. |
| `eslint.config.mjs` | Shrinking per-file count allowlist and local rule for `src/**`. |
| `doc/tasks/US-2199-platform-layer/README.md` | This investigation and implementation plan. |

**No changes:** `src/ipc/contracts/shell.ts`, `src/ipc/contracts/clipboard.ts`, `src/ipc/main/shell-handlers.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/renderer/api/app-startup.ts`, `src/shared/i18n/en/`, `scripts/dev-mneme-model.mjs`, `src/main/pipe-server.ts`, `src/main/snip-service.ts`, `src/main/mneme-service.ts`, `src/main/open-window.ts`, `src/renderer/core/utils/startup-data-path.ts`, `src/renderer/content/link-utils.ts`, `launcher/`, `snip-tool/`, `mneme/`, `src/board-shim.ts`, `src/shared/board-bridge-version.ts`, `doc/active-work.md`, and `doc/epics/EPIC-212.md`. The startup fixes and native ports belong to later work; no board bridge change is planned. Do not grow any roadmap section 2.3 god file.
