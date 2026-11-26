# US-2215: Terminal, VLC and Tor

[EPIC-214: Linux desktop integration](../../epics/EPIC-214.md) · Active

## Goal

Make terminal launching and VLC/Tor discovery work on Ubuntu 26.04 GNOME Wayland, with settings that describe Linux accurately. Preserve Windows behavior and Windows-specific wording on Windows.

## Background

- `src/renderer/components/tree-provider/item-menus.ts` and `src/renderer/ui/sidebar/menu-bar-folder-ui.ts` call `src/renderer/api/terminal.ts`'s `openTerminalAt`. That reads `terminal.command`, calls `api.detectTerminal()` if empty, saves a detected command, and otherwise falls back to `powershell`. `src/ipc/main/shell-handlers.ts` delegates to `src/main/terminal-launcher.ts`: `detectTerminal` uses Windows `where` and falls back to `cmd`; `openTerminalAt` returns immediately outside Windows, validates a directory on Windows, then runs `cmd.exe /c start` with command-specific arguments and `cwd`.
- `TerminalSectionView` in `src/renderer/editors/settings/sections/SettingsSections.ts` uses `ChoiceField`: it shows the Windows choices and retains unknown saved values but has no custom-text input. `terminal.command` defaults to an empty string in `src/renderer/api/settings-schema.ts`. A setting can also be edited in the JSON5 settings file.
- `src/main/vlc-launcher.ts` prefers a configured path, otherwise checks two Windows Program Files paths. It throws a useful missing-VLC error if neither is found; `src/renderer/editors/video/VideoEditor.ts` calls it through `src/ipc/main/media-handlers.ts`.
- `src/renderer/editors/browser/BrowserEditor.ts` refuses a new Tor page if `tor.exe-path` is empty or does not exist. `BrowserTorModel.init` passes the setting through the existing Tor channel; `src/main/tor-service.ts` starts `SidecarProcess` for browser partitions and separately for `acquireFetch`, which currently rejects an empty setting. `src/renderer/api/node-fetch.ts` uses the latter route. The service retains the executable for restart and deliberately reapplies the proxy on failure to keep browser partitions fail-closed. `SidecarProcess` converts spawn failures into result data.
- `src/renderer/api/settings-schema.ts` owns defaults and comments, consumed by `src/renderer/api/settings.ts` when rewriting JSON5. Its Mneme, Tor, VLC and terminal comments currently name Windows executables; `src/renderer/editors/settings/settings-catalog.ts` also describes terminal, VLC and Tor in Windows terms. The existing `tor.exe-path` key is persisted and exposed by settings APIs: keep that key for compatibility, even though its spelling includes `.exe`; do not display the key as a Linux label or describe its spelling as an executable name. Checklist row 16's literal wording must be read with this compatibility constraint: the JSON property name remains visible in the settings file.
- `src/shared/platform.ts` exports `isWindows` and `isLinux`; `src/shared/platform-features.ts` owns `getPlatformFeature`, currently marking Linux `terminal.launch`, `media.vlcAutoDetect`, and `memory.mnemeSidecar` unavailable. Mneme on Linux is out of scope. The [epic checklist](../../epics/EPIC-214-checklist.md) rows 14–16 define the desktop checks.

## Implementation Plan

- [x] **Executable lookup:** add `src/main/linux-executable-lookup.ts` as the owner of Linux PATH lookup, shared by the Linux terminal collaborator, VLC and Tor. Use Node filesystem executable-access checks and `path` in main, search PATH entries in order, support absolute paths and names, reject directories, and return an absent result for missing or non-executable files. Do not invoke a shell or use Windows `where`; empty PATH and paths containing spaces must work. Keep explicit configured values authoritative: never silently replace a broken explicit value with a detected program. Reuse `isLinux` from `src/shared/platform.ts`; no new direct `process.platform` checks.
- [x] **Terminal:** create `src/main/linux-terminal-launcher.ts` beside `src/main/terminal-launcher.ts`; it owns Linux detection and the per-terminal argument table, reusing the Linux lookup and the owner's `spawn`/`cwd`/detached/unref pattern. Probe, in order, `x-terminal-emulator`, `ptyxis`, `gnome-terminal`, `kgx`, `konsole`, `xfce4-terminal`, and `xterm`; do not probe `xdg-terminal-exec`, which has no working-directory contract. Resolve the selected executable to its realpath and use its basename as the kind, mirroring the Windows `commandKind` mapping. Use the same table for a custom `terminal.command` naming a known terminal:

  | Real executable basename | Arguments |
  |---|---|
  | `ptyxis` | `--new-window`, `-d`, `dirPath` |
  | `gnome-terminal`, `kgx`, `xfce4-terminal` | one argument `--working-directory=<dirPath>` |
  | `konsole` | `--workdir`, `dirPath` |
  | `xterm`, unknown executables | none |

  Launch directly with `cwd: dirPath` in every case and pass arguments as an argv array without shell interpolation. The directory remains in one argv element, including spaces. Treat `terminal.command` as one executable name or absolute path, not a shell command line; custom wrappers can provide extra arguments. Persist the detected name, such as `x-terminal-emulator`, rather than its realpath so later alternatives changes are followed. Report missing executable or invalid directory through the existing warning path, including asynchronous spawn errors. In `terminal-launcher.ts` select the Linux collaborator using `isLinux`/`isWindows`, retain the Windows code and arguments, replace its direct platform check and remove its baseline entry from `eslint.config.mjs`. Return an empty detection result when Linux has none; in `src/renderer/api/terminal.ts` do not persist an empty result or use the Windows `powershell` fallback on Linux, and surface a clear missing-terminal warning instead. Keep Windows detection and persistence unchanged.
- [x] **Linux settings input:** extract `TerminalSectionView` and `VideoPlayerSectionView` from the roadmap §2.3 god file `src/renderer/editors/settings/sections/SettingsSections.ts` into `src/renderer/editors/settings/sections/TerminalSection.ts` and `src/renderer/editors/settings/sections/VideoPlayerSection.ts`; update `src/renderer/editors/settings/SettingsView.ts` imports. Terminal section owns the Linux text input bound through the existing `appSettingsStore` to `terminal.command` (empty means auto-detect), and retains the existing `ChoiceField` and choices on Windows. Use a suitable existing settings field or UIKit input with its existing store subscription/disposal pattern; do not expand the god file. Update the terminal section header selection in `src/renderer/editors/settings/settings-catalog.ts` to use a Linux-specific localized description while retaining the Windows key and wording.
- [x] **VLC:** `src/main/vlc-launcher.ts` remains the owner and reuses the Linux lookup only when the configured setting is empty on Linux. Resolve `vlc` on PATH; retain the Windows Program Files logic and configured-path precedence. Return the existing missing-VLC message when absent, and handle a failed Linux spawn without an unhandled `error` event. Keep the existing media IPC contract and VideoEditor error presentation.
- [x] **Tor:** add `src/main/tor-executable.ts` beside `src/main/tor-service.ts` as the Tor resolver, reusing the Linux PATH lookup. With an empty Linux setting probe only `tor`, with no other names. Use any other compatible binary by setting its path explicitly; it must support the existing `-f <torrc>`, `Bootstrapped 100%` readiness and SOCKS contract. An explicit path is authoritative; on Windows retain existing behavior. Both `TorService.startForPartition` and `acquireFetch` use the same resolver before sidecar startup and store the resolved executable for restart. If the setting is empty and `tor` is absent, return `{ success: false, error: "Tor not found on PATH. Install Tor or set the Tor executable path in Settings." }` without starting a process. This is a new main-process error string, not an i18n key; the fetch path returns the same message through `acquireFetch`. Preserve pending-start sharing, lease cleanup, active-partition cleanup and `settleStart` fail-closed proxy behavior. In `BrowserEditor.createNew`, preserve Windows preflight and allow Linux to proceed through the already-armed proxy. `browser-pages.ts` `showBrowserPage` calls `BrowserTorModel.init`; that function sets error status and appends the returned error to `torLog`, which `BrowserEditorView.syncTor` passes to `TorStatusOverlayView` for display. Thus the missing message is visible in the Tor overlay with retry, with no direct network fallback or hang. Keep `tor.exe-path` unchanged.
- [x] **Tor first load (all platforms):** a Tor page opened with a URL (`pages.showBrowserPage({ tor: true, url })`, used by scripts and agents) loses its first load. `BrowserEditor.createNew` calls `editor.navigate(options.url)` before `showBrowserPage` in `src/renderer/editors/browser/browser-pages.ts` starts Tor with an unawaited `editor.tor.init()`, so the request reaches the armed but not yet listening SOCKS port, the proxy refuses it (correct, fail-closed) and the tab stays on `chrome-error://chromewebdata/` after Tor connects. Measured in the VM with tnet: the first load failed; a reload after connection returned `{"IsTor":true}`. Fix: in `createNew`, do not navigate when `options.tor` is set; in `showBrowserPage`, navigate after a successful start: `void editor.tor.init().then((r) => { if (r.success && options.url) editor.navigate(options.url); })`. On failure the URL is not loaded and the overlay shows the error as today. `browser-pages.ts` owns the open sequence; `BrowserTorModel.init` already returns `{ success }`, so no new state is needed. Non-Tor pages keep navigating in `createNew`.
- [x] **Availability:** in `src/shared/platform-features.ts`, mark Linux `terminal.launch` and `media.vlcAutoDetect` available now that the OS integration exists. An individual absent program is a discoverable missing dependency, not a permanently unsupported platform feature. Leave `memory.mnemeSidecar` unavailable on Linux; settings comments must not imply that Mneme runs there. Preserve other platforms' entries.
- [x] **Settings text and dialogs:** `src/renderer/api/settings-schema.ts` owns platform-specific comments for `mneme.enabled`, `tor.exe-path`, `vlc-path`, and `terminal.command`, using shared platform/feature helpers. Keep defaults and Windows comments unchanged; Linux comments describe PATH detection, executable-only terminal input and Mneme unavailability. `src/renderer/editors/settings/settings-catalog.ts` owns corresponding platform-aware discovery purposes. Add these Linux-specific keys to `src/shared/i18n/en/settings.ts`: `settings.terminalLinuxDescription`, `settings.vlcExecutableLabel`, `settings.selectVlcExecutable`, `settings.torExecutableLabel`, `settings.selectTorExecutable`, and `settings.removeTorExecutablePath`. Use the existing `settings.autoDetect` for the empty Linux Tor path and existing `settings.removeVlcPath` for VLC. Select the new keys in their section/model while retaining all existing Windows messages. `src/shared/i18n/en/browser.ts` does not change: the Tor service returns the explicit error string above through the existing overlay flow. Linux VLC and Tor labels, browse titles, clear labels, placeholders and help must avoid `.exe`; use unrestricted file selection rather than the Windows `exe` filter in `VideoPlayerSectionView` and `BrowserProfilesSectionModel.handleBrowseTorExe`. The existing Windows filter, labels and empty-state semantics remain intact. Update `assets/guides/tabs-and-navigation/file-explorer-and-panels.md` and `assets/guides/scripting/api/app.md` for the changed behavior, preserving accurate Windows details and the actual settings key in API references. Translate the new English catalog messages in every built-in pack at epic completion, per EPIC-214.

### Required verification

Run `npm run typecheck`, `npm run lint`, `npm run guides:check`, and the existing affected Windows `test:ui` areas for terminal, Tor, video and settings unchanged; keep Linux CI green, per epic decision 7. Do not modify `integration-test/` or add tests or harnesses. Claude owns live Linux and VM checks below.

### Representative changes

These are intended shapes, not complete patches; resolve types and asynchronous errors in the owning modules.

```ts
// src/main/terminal-launcher.ts — before
if (process.platform !== "win32") return;
// after: platform dispatch; retain the Windows launch body
if (isLinux) return openLinuxTerminalAt(dirPath, command);
if (!isWindows) return;
```

```ts
// src/main/vlc-launcher.ts — before
return DEFAULT_VLC_PATHS.find((p) => fs.existsSync(p));
// after, after the existing configured-path check
return isLinux ? findLinuxExecutable("vlc") : DEFAULT_VLC_PATHS.find((p) => fs.existsSync(p));
```

```ts
// src/renderer/api/settings-schema.ts — before → after, keeping the Windows text
comment: "Absolute path to tor.exe. Required for Browser (Tor) mode; empty disables it.\n..."
comment: isLinux ? "Tor executable path; empty searches PATH for tor." : /* existing Windows comment */
```

## Concerns / Open questions

- The persisted `tor.exe-path` identifier cannot disappear from raw settings without a migration and API compatibility work. This plan preserves it and removes executable-suffix wording from Linux labels and comments; Claude should record the checklist interpretation if row 16 is judged literally.
- PATH resolution must occur in the main process environment that will spawn the program. A desktop-launched app can have a different PATH from an interactive shell; the explicit setting remains the escape hatch.
- A terminal executable may successfully start and exit later; distinguish failure to spawn from its later exit. Do not interpret user-provided text through a shell. Use `cwd` so a custom executable receives the folder even when its path contains spaces.
- No new cross-process protocol or `window.persephone` API is planned. If implementation changes that bridge, bump `BOARD_BRIDGE_VERSION` and add its history line. No board rules belong outside `src/shared/board/` and board registries. No `await import()` or wrapper to bypass an import zone; fix import direction. Strict-folder null fixes are type-only unless recorded here as a behavioral change. `SettingsSections.ts` must shrink; no roadmap §2.3 god file may grow.

### Claude's VM checks (not implementation steps)

On the EPIC-214 Ubuntu 26.04 GNOME Wayland VM, run checklist rows 14-16: check detected terminal and a configured executable in folders with spaces, including a Ptyxis window already open, and the missing-terminal warning. The VM measurement found `x-terminal-emulator` resolves to `/usr/bin/ptyxis`; `gnome-terminal`, `kgx`, `konsole` and `xterm` were absent. Bare `x-terminal-emulator` with cwd `/tmp/c d` did not open a shell there while `ptyxis --new-window` did. `xdg-terminal-exec` was installed and configured as GNOME's default. Check VLC and Tor with PATH installations and with each absent, including Tor browser overlay and fetch failure without a direct connection. Inspect Linux settings UI and regenerated JSON5 comments, including Mneme's unavailable status and the retained key spelling; compare Windows-specific behavior and wording on Windows.

## Acceptance Criteria

- Linux detects an installed terminal or reports it missing; custom executable and auto-detected terminal open at the chosen folder. Windows launch and settings behavior remain unchanged.
- A Tor page opened with a URL loads that URL once Tor connects, on every platform; a failed start loads nothing.
- Linux finds VLC and Tor on PATH with empty settings, honors configured paths, and reports missing dependencies cleanly. Tor remains fail-closed; browser, fetch and restart use the same executable resolution.
- Linux settings labels, defaults and descriptive comments do not name Windows executables; the retained compatibility key is documented above. Mneme is accurately described as unavailable. Windows text and behavior remain unchanged.
- Feature data, regression checks and epic-required verification match the implementation; Claude owns the live VM checks. Translations are deferred to epic completion.

## Files Changed

| Path | Planned change |
|---|---|
| `src/main/linux-executable-lookup.ts`, `src/main/linux-terminal-launcher.ts`, `src/main/tor-executable.ts` | New focused Linux lookup, terminal and Tor resolver collaborators |
| `src/main/terminal-launcher.ts`, `src/main/vlc-launcher.ts`, `src/main/tor-service.ts` | Dispatch and resolve external tools, retain Windows behavior and Tor safety |
| `eslint.config.mjs`, `src/shared/platform-features.ts`, `src/renderer/api/terminal.ts`, `src/renderer/api/settings-schema.ts` | Platform availability, terminal error handling and platform-specific comments |
| `src/renderer/editors/browser/BrowserEditor.ts`, `src/renderer/editors/browser/browser-pages.ts` | Allow Linux Tor resolution through the existing start flow; Tor pages navigate to their first URL only after Tor connects |
| `src/renderer/editors/settings/sections/SettingsSections.ts`, `src/renderer/editors/settings/sections/TerminalSection.ts`, `src/renderer/editors/settings/sections/VideoPlayerSection.ts`, `src/renderer/editors/settings/SettingsView.ts` | Extract sections, add Linux command input and VLC dialog handling |
| `src/renderer/editors/settings/sections/BrowserProfilesSection.ts`, `BrowserProfilesSectionModel.ts`, `src/renderer/editors/settings/settings-catalog.ts` | Linux Tor settings and platform-aware descriptions |
| `src/shared/i18n/en/settings.ts` | Add the six Linux settings keys listed above; retain Windows strings |
| `assets/guides/tabs-and-navigation/file-explorer-and-panels.md`, `assets/guides/scripting/api/app.md` | Update affected user guidance |

**No changes planned:** `src/ipc/contracts/shell.ts`, `src/ipc/main/shell-handlers.ts`, `src/ipc/main/media-handlers.ts`, `src/ipc/tor-ipc.ts`, `src/renderer/api/node-fetch.ts`, `src/renderer/editors/browser/BrowserTorModel.ts`, `src/main/sidecar-process.ts`, `src/shared/i18n/en/browser.ts`, `integration-test/`, `src/main/mneme-service.ts`, board bridge and board registries. Their existing contracts and helpers are reused.

## VM results (Claude, 2026-11-26)

Ubuntu 26.04 GNOME Wayland VM, dev build of this change. VLC 3 from apt; Tor not installed; a Tor-compatible drop-in
(an Arti-based binary implementing the `-f <torrc>` contract) built in the VM and set as the Tor path.

| Check | Result |
|---|---|
| Empty `terminal.command`: detects and saves `x-terminal-emulator`, opens Ptyxis with `--new-window -d` in a folder with spaces | Pass |
| Second "Open Terminal here" while a Ptyxis window is open opens a new window in the new folder | Pass |
| Custom executable path with a space (`/tmp/my term.sh`) runs with that folder as cwd | Pass |
| Missing custom command shows "Terminal executable not found or not executable: …" | Pass |
| Empty `vlc-path` finds `/usr/bin/vlc` on PATH; "Open in VLC" plays the stream | Pass |
| VLC not executable on PATH shows the "VLC Error" dialog, no crash | Pass |
| Tor page opened with a URL loads it on the first try after Tor connects (`{"IsTor":true}`) | Pass (was failing before this change) |
| Empty Tor path with no `tor` on PATH: overlay "Tor not found on PATH…", Reconnect offered, page stays `about:blank` | Pass |
| Linux settings file comments and Settings page: no `.exe`, `pwsh`, `cmd`; Mneme marked unavailable; key `tor.exe-path` kept | Pass (`.cmd` appears only as a file extension in the text-file list) |

Windows `test:ui` (dev target): capabilities/terminal, browser/tor (including the tagged Tor network test, run with the Windows build of the same drop-in), editors/video, core/settings, tools/settings-page — 20 of 20 pass. One terminal test failed once on the folder-sidebar click and passed on two reruns (flaky setup, not the launch path).

Follow-up outside this task: the Browser Profiles section still shows the Windows website sign-in explanation
(`settings.windowsSsoExplanation`) on Linux; epic decision 4 says that feature should be hidden or explained as not
offered there.
