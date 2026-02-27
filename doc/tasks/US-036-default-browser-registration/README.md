# US-036: Register as Default Browser in Windows

## Status

**Status:** Completed
**Priority:** Medium

## Summary

Allow js-notepad to register itself as a default browser in Windows, so clicking links in other applications opens them in js-notepad's built-in browser editor.

## Why

- Users who rely on js-notepad's internal browser for daily browsing have no way to make it the OS-level default
- Clicking links in emails, chat apps, documents, etc. always opens a separate browser instead of js-notepad
- Completing the browser experience — makes the internal browser a first-class citizen on the system

## Background Research

### How Windows Default Browser Registration Works

Windows identifies browser candidates through four registry areas. All can use `HKCU` (per-user, no admin needed).

#### 1. StartMenuInternet Registration

```
HKCU\SOFTWARE\Clients\StartMenuInternet\JSNotepad
    (Default) = "JS-Notepad"
    \DefaultIcon
        (Default) = "C:\...\js-notepad.exe,0"
    \shell\open\command
        (Default) = "C:\...\js-notepad.exe"
    \Capabilities
        ApplicationDescription = "JS-Notepad integrated browser"
        ApplicationIcon = "C:\...\js-notepad.exe,0"
        ApplicationName = "JS-Notepad"
        \URLAssociations
            http = JSNotepadURL
            https = JSNotepadURL
        \FileAssociations
            .htm = JSNotepadHTML
            .html = JSNotepadHTML
```

#### 2. ProgID Registration

```
HKCU\SOFTWARE\Classes\JSNotepadURL
    (Default) = "JS-Notepad URL"
    URL Protocol = ""          ← critical empty string
    \DefaultIcon
        (Default) = "C:\...\js-notepad.exe,0"
    \shell\open\command
        (Default) = "\"C:\...\js-notepad.exe\" \"%1\""

HKCU\SOFTWARE\Classes\JSNotepadHTML
    (Default) = "JS-Notepad HTML Document"
    \DefaultIcon
        (Default) = "C:\...\js-notepad.exe,0"
    \shell\open\command
        (Default) = "\"C:\...\js-notepad.exe\" \"%1\""
```

#### 3. RegisteredApplications Entry

```
HKCU\SOFTWARE\RegisteredApplications
    JS-Notepad = SOFTWARE\Clients\StartMenuInternet\JSNotepad\Capabilities
```

#### 4. App Paths (Recommended)

```
HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\js-notepad.exe
    (Default) = "C:\...\js-notepad.exe"
    UseUrl = 1  (DWORD)
```

### How URLs Are Passed to the Browser

Windows runs the registered command with `%1` replaced by the URL:

```
"C:\...\js-notepad.exe" "https://example.com"
```

For Electron apps:
- **Cold start**: URL in `process.argv`
- **Already running** (with `requestSingleInstanceLock`): URL in `second-instance` event's `argv`

### Key Constraints

- **Cannot programmatically set default**: Windows 10/11 protects `UserChoice` registry keys with a hash + kernel driver (`UCPD.sys`). Can only guide user to `ms-settings:defaultapps`.
- **Electron's `app.setAsDefaultProtocolClient()`** only creates basic protocol handlers — not the full browser registration (StartMenuInternet, Capabilities, RegisteredApplications).
- **`SHChangeNotify(SHCNE_ASSOCCHANGED)`** must be called after writing registry keys so Windows picks up the changes.

## Acceptance Criteria

- [x] js-notepad appears in Windows Settings > Default Apps > Web browser list
- [x] Clicking a URL in another app opens it in js-notepad's browser editor
- [x] Works when js-notepad is already running (single instance, URL routed to existing window)
- [x] Works on cold start (URL parsed from `process.argv`)
- [x] Settings page has "Register as Default Browser" / "Unregister" option
- [x] Registry keys written to HKCU (no admin required)
- [x] Registry keys cleaned up on unregister
- [x] No regressions to existing functionality (file opening, command-line args)
- [x] Documentation updated

## Technical Approach

### Phase 1: Registry Management (Main Process)

Create a `browser-registration.ts` service in main process:
- `registerAsDefaultBrowser()` — writes all HKCU registry keys, calls `SHChangeNotify`
- `unregisterAsDefaultBrowser()` — removes all registry keys, calls `SHChangeNotify`
- `isRegisteredAsDefaultBrowser()` — checks if registry keys exist
- Use Node.js registry access (native `child_process` with `reg.exe`, or `regedit`/`winreg` npm package)

### Phase 2: URL Handling (Main Process)

Modify app startup to handle incoming URLs:
- Parse `process.argv` for `http://`/`https://` URLs on cold start
- Handle `second-instance` event for URLs when already running
- Route incoming URL to `openUrlInBrowserTab()` (or create new browser page)
- Ensure `requestSingleInstanceLock()` is in place

### Phase 3: Settings UI (Renderer)

Add to Settings page (Browser section):
- "Register as Default Browser" button (when not registered)
- "Unregister" button (when registered)
- "Open Windows Default Apps Settings" button (to let user actually select js-notepad)
- Status indicator showing current registration state

### Phase 4: File Association (Optional)

Handle `.html`/`.htm` file associations:
- Decide: open in text editor (current behavior) or browser preview?
- Could offer both via "Open With" context in the app

## Concerns

1. **Registry access method**: `reg.exe` via `child_process` is simplest but parsing output is fragile. npm packages like `winreg` provide cleaner API. Need to evaluate which approach is most reliable.

2. **Existing `process.argv` handling**: js-notepad already parses command-line args to open files. Need to distinguish URLs from file paths without breaking existing behavior.

3. **Portable/non-installed mode**: If the exe path changes (e.g., user moves the folder), registry entries become stale. May need to re-register on startup if exe path doesn't match.

4. **MSI installer integration**: Could write registry keys during installation via WiX. But per-user HKCU approach at runtime is more flexible and doesn't require installer changes.

5. **File associations conflict**: js-notepad already opens `.html` files as text. Registering `.html` file association for the browser would change this behavior. May want to skip file associations initially and only register URL protocols (`http`/`https`).

## Files to Modify

- `src/main/browser-registration.ts` — NEW: registry management service
- `src/main/main.ts` — URL handling on startup, `second-instance` event
- `src/ipc/browser-registration-ipc.ts` — NEW: IPC channels for register/unregister/check
- `src/renderer/store/app-settings.ts` — settings integration (or direct IPC calls)
- `src/renderer/features/settings/SettingsPage.tsx` — UI for register/unregister
- `src/renderer/store/page-actions.ts` — routing incoming URLs to browser editor

## Implementation Progress

### Phase 1: Registry Management ✅
- [x] Using `reg.exe` via `child_process` — simplest, no npm packages needed
- [x] `registerAsDefaultBrowser()` — writes all HKCU keys (StartMenuInternet, ProgIDs, RegisteredApplications)
- [x] `unregisterAsDefaultBrowser()` — removes all registry keys
- [x] `isRegisteredAsDefaultBrowser()` — checks StartMenuInternet key existence
- [x] `openDefaultAppsSettings()` — opens `ms-settings:defaultapps`
- [x] `SHChangeNotify` called via PowerShell after registry changes
- [x] All registry entries point to `js-notepad-launcher.exe` (consistent with NSIS installer)

### Phase 2: URL Handling ✅
- [x] URL detection in `process.argv` parsing (cold start via `window-handlers.ts`)
- [x] `getUrlToOpen()` IPC endpoint for renderer to get URL on init
- [x] `second-instance` handler routes URLs to `handleOpenUrl()` (not `handleOpenFile()`)
- [x] Pipe server already handles URLs via OPEN command (from US-037)
- [x] `requestSingleInstanceLock()` already active

### Phase 3: Settings UI ✅
- [x] IPC endpoints: `registerAsDefaultBrowser`, `unregisterAsDefaultBrowser`, `isRegisteredAsDefaultBrowser`, `openDefaultAppsSettings`
- [x] Settings page "Default Browser" section between Links and File Search
- [x] Registration status indicator (green "Registered" / register button)
- [x] "Open Windows Default Apps" button
- [x] Unregister button when registered

### Phase 4: File Associations — Skipped
- Skipped — `.html`/`.htm` file associations would conflict with existing text editor behavior

## Notes

### 2026-02-27
- Implementation completed. Registry keys mirror NSIS installer section 5 exactly.
- All paths point to launcher exe for consistent behavior with pipe IPC
- Cold start URL handling added (was missing — `process.argv` only checked for file paths before)
- `second-instance` handler now checks for URLs before file path logic
- Added `eOpenExternalUrl` event to separate OS URLs from editor link clicks — OS URLs always open in internal browser tab, editor links respect `link-open-behavior` setting
- Launcher `build.rs` updated with ProductName/FileDescription so Windows Default Apps shows "JS-Notepad" instead of "Electron"
- `openDefaultAppsSettings()` deep-links to `ms-settings:defaultapps?registeredAppUser=js-notepad` to open directly to the JS-Notepad page

### 2026-02-26
- Task created based on research into Windows default browser registration
- Key finding: cannot programmatically set as default — must guide user to Windows Settings
- Decided on HKCU approach (no admin) over installer-based HKLM approach
- File associations (`.html`/`.htm`) marked as optional — may conflict with existing text editor behavior

## Related

- Related task: US-025 (Basic Browser Editor)
- Related task: US-027 (Browser Profiles & Incognito)
- Related doc: [Browser Editor Architecture](../../architecture/browser-editor.md)
