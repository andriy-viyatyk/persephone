# US-417: VLC Integration — Settings and Launch

## Goal

Add an `openInVlc` IPC endpoint so the video player can launch VLC with a URL, and add a
**Video Player** settings section to `SettingsPage.tsx` for the `vlc-path` and
`video-stream.port` settings (already defined in `settings.ts` by US-416).

---

## Background

### Settings already in place (US-416)

`src/renderer/api/settings.ts` already has:
```typescript
// AppSettingsKey union (lines 41–42):
| "vlc-path"
| "video-stream.port"

// settingsComments (lines 70–71):
"vlc-path": "Path to VLC executable.\nLeave empty to auto-detect C:\\Program Files\\VideoLAN\\VLC\\vlc.exe.",
"video-stream.port": "Port for the local video streaming server.\n...",

// defaultAppSettingsState (lines 94–95):
"vlc-path": "",
"video-stream.port": 7866,
```

No changes needed to `settings.ts`.

### IPC pattern

Every IPC endpoint follows a 4-file chain:
1. `src/ipc/api-types.ts` — `Endpoint` enum + `Api` type
2. `src/ipc/main/controller.ts` — handler + `bindEndpoint()` registration
3. `src/ipc/renderer/api.ts` — `ApiCalls` client method

Primitives (string, boolean) need no entry in `api-param-types.ts`.

Reference — US-416 additions to the same chain:
- Endpoint enum: `createVideoStreamSession`, `deleteVideoStreamSession`, `deleteVideoStreamSessionsByPage`
- Controller: dynamic import of `../../main/video-stream-server`
- Renderer api: `executeOnce<T>(Endpoint.xxx, ...args)`

### Settings UI pattern — TorProfileRow

`src/renderer/editors/settings/SettingsPage.tsx` lines 671–755 (`TorProfileRow`) is the
template to follow. Key points:
- `settings.use("key")` hook for reactive reads
- `settings.set("key", value)` to persist
- File browse: `api.showOpenFileDialog({ title, filters })` → `result?.[0]`
- Port field: `<input className="settings-field-label">` (see C3 below) with onBlur validation (1024–65535)
- Path display: shows `fpBasename(path)` or placeholder text
- Clear button: `<button className="profile-bookmarks-clear">×</button>`
- All CSS classes already defined in the styled component — **no new styles needed**

`TorProfileRow` is rendered inside `BrowserProfilesSection` (line 942).
`VideoPlayerSection` will be a standalone section outside `BrowserProfilesSection`, like
`McpSection` (line 1396) and `ScriptLibrarySection` (line 1400).

### CSS class rename — `tor-field-label` → `settings-field-label`

The class `tor-field-label` (SettingsPage.tsx line 381) is a generic layout utility
(fontSize 11, minWidth 42, flexShrink 0) that doesn't relate to Tor specifically.
This task renames it throughout `SettingsPage.tsx` so `VideoPlayerSection` can use it
without creating a false dependency on Tor styling. Three occurrences total:
- Line 381: CSS definition in the styled component
- Line 723: `className="tor-field-label"` in `TorProfileRow` (tor.exe label)
- Line 738: `className="tor-field-label"` in `TorProfileRow` (Port label)

### Error handling for VLC not found

`src/renderer/api/ui.ts` exposes:
```typescript
ui.textDialog(options: ITextDialogOptions): Promise<ITextDialogResult | null>
// ITextDialogOptions: { title?, text?, buttons?, readOnly?, width?, height? }
```

`vlc-launcher.ts` (main process) throws when VLC cannot be found. The IPC layer in
`controller.ts` `bindEndpoint` catches the throw and sends an `Error` object back.
The renderer's `executeOnce` then rejects the promise. The VideoEditorModel (US-412)
catches the rejection from `api.openInVlc()` and calls:
```typescript
ui.textDialog({
    title: "VLC Not Found",
    text: "VLC not found. Please set the VLC path in Settings → Video Player.",
    readOnly: true,
});
```
No additional action needed in US-417 for error display — that call belongs in US-412.

### External process launch pattern

`src/main/tor-service.ts` spawns `tor.exe` via `child_process.spawn()` with
`{ detached: true, stdio: 'ignore' }` + `proc.unref()`. VLC uses the same pattern.

av-player reference:
```typescript
// D:\projects\av-player\src\main\streaming-server.ts
const vlcProcess = require('child_process').spawn(vlcPath, [url], {
    detached: true,
    stdio: 'ignore',
});
vlcProcess.unref();
```

`shell.openPath` is not used because it cannot pass URL arguments to the process.

### Default VLC paths

av-player uses only `C:\Program Files (x86)\VideoLAN\VLC\vlc.exe`.
Persephone checks both install locations (from EPIC-024):
```
C:\Program Files\VideoLAN\VLC\vlc.exe        (64-bit install)
C:\Program Files (x86)\VideoLAN\VLC\vlc.exe  (32-bit install)
```
`fs.existsSync` is allowed in main-process files — see `src/main/main-setup.ts`.
Persephone is Windows-only — no cross-platform path logic needed.

### Where VideoPlayerSection sits in the settings card

Current settings card render order (SettingsPage.tsx ~line 1350):
1. Theme
2. `<BrowserProfilesSection />` (contains TorProfileRow at end)
3. Links
4. Default Browser
5. File Search
6. `<McpSection />`
7. `<ScriptLibrarySection />`
8. `<DrawingLibrarySection />`
9. "View Settings File" button

`<VideoPlayerSection />` will be added after `<DrawingLibrarySection />`, before the button:
```tsx
<DrawingLibrarySection />

<hr className="divider" />

<VideoPlayerSection />

<hr className="divider" />

<button ...>View Settings File</button>
```

---

## Implementation Plan

### Step 1 — Create `src/main/vlc-launcher.ts` (new file)

```typescript
import { spawn } from "child_process";
import fs from "node:fs";

const DEFAULT_VLC_PATHS = [
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
];

export function openInVlc(url: string, configuredPath?: string): void {
    const vlcPath = resolveVlcPath(configuredPath);
    if (!vlcPath) {
        throw new Error(
            "VLC not found. Please set the VLC path in Settings → Video Player.",
        );
    }
    const proc = spawn(vlcPath, [url], {
        detached: true,
        stdio: "ignore",
    });
    proc.unref();
}

function resolveVlcPath(configured?: string): string | undefined {
    if (configured) return configured;
    return DEFAULT_VLC_PATHS.find((p) => fs.existsSync(p));
}
```

### Step 2 — Add endpoint to `src/ipc/api-types.ts`

**`Endpoint` enum** — add after `deleteVideoStreamSessionsByPage` (line ~59):
```typescript
// Before:
    deleteVideoStreamSessionsByPage = "deleteVideoStreamSessionsByPage",
}

// After:
    deleteVideoStreamSessionsByPage = "deleteVideoStreamSessionsByPage",
    openInVlc = "openInVlc",
}
```

**`Api` type** — add after the `deleteVideoStreamSessionsByPage` entry (line ~119):
```typescript
// Before:
    [Endpoint.deleteVideoStreamSessionsByPage]: (pageId: string) => Promise<void>;
};

// After:
    [Endpoint.deleteVideoStreamSessionsByPage]: (pageId: string) => Promise<void>;
    [Endpoint.openInVlc]: (url: string, vlcPath?: string) => Promise<void>;
};
```

### Step 3 — Add handler to `src/ipc/main/controller.ts`

**Handler method** — add after `deleteVideoStreamSessionsByPage` handler (line ~234):
```typescript
openInVlc = async (event: IpcMainEvent, url: string, vlcPath?: string): Promise<void> => {
    const { openInVlc } = await import("../../main/vlc-launcher");
    openInVlc(url, vlcPath);
};
```

**`init()` registration** — add after `deleteVideoStreamSessionsByPage` registration (line ~299):
```typescript
bindEndpoint(Endpoint.openInVlc, controllerInstance.openInVlc);
```

### Step 4 — Add client method to `src/ipc/renderer/api.ts`

Add after `deleteVideoStreamSessionsByPage` (line ~238):
```typescript
openInVlc = async (url: string, vlcPath?: string) => {
    return executeOnce<void>(Endpoint.openInVlc, url, vlcPath);
};
```

### Step 5 — Update `src/renderer/editors/settings/SettingsPage.tsx`

**5a — Rename CSS class** (3 occurrences, use replace-all):

`"tor-field-label"` → `"settings-field-label"` everywhere in this file.
This covers:
- The CSS definition in the styled component (line 381)
- Two `className` usages in `TorProfileRow` (lines 723, 738)

**5b — Add browse helper function** after `browseTorExe` (line ~669):
```typescript
async function browseVlcExe(): Promise<string | undefined> {
    const result = await api.showOpenFileDialog({
        title: "Select vlc.exe",
        filters: [{ name: "Executable Files", extensions: ["exe"] }],
    });
    return result?.[0];
}
```

**5c — Add `VideoPlayerSection` component** — add it after `DrawingLibrarySection` function,
before the main render function. Pattern mirrors `TorProfileRow` but as a full section:

```tsx
function VideoPlayerSection() {
    const vlcPath = settings.use("vlc-path");
    const videoStreamPort = settings.use("video-stream.port");
    const [portValue, setPortValue] = useState(String(videoStreamPort));

    useEffect(() => {
        setPortValue(String(videoStreamPort));
    }, [videoStreamPort]);

    const handleBrowseVlc = async () => {
        const filePath = await browseVlcExe();
        if (filePath) {
            settings.set("vlc-path", filePath);
        }
    };

    const handleClearVlc = () => {
        settings.set("vlc-path", "");
    };

    const handlePortBlur = () => {
        const num = parseInt(portValue, 10);
        if (num >= 1024 && num <= 65535) {
            settings.set("video-stream.port", num);
        } else {
            setPortValue(String(videoStreamPort));
        }
    };

    const handlePortKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
        }
    };

    const vlcFilename = vlcPath ? fpBasename(vlcPath) : "";

    return (
        <>
            <div className="section-label">Video Player</div>
            <div className="section-hint">
                VLC integration and local video streaming server settings
            </div>
            <div className="profile-row-group">
                <div className="profile-bookmarks-line">
                    <span className="settings-field-label">vlc.exe:</span>
                    {vlcFilename ? (
                        <span
                            className="profile-bookmarks-path"
                            title={vlcPath}
                            onClick={handleBrowseVlc}
                        >
                            {vlcFilename}
                        </span>
                    ) : (
                        <span
                            className="profile-bookmarks-placeholder"
                            onClick={handleBrowseVlc}
                        >
                            Auto-detect
                        </span>
                    )}
                    {vlcFilename && (
                        <button
                            className="profile-bookmarks-clear"
                            onClick={handleClearVlc}
                            title="Remove VLC path"
                        >
                            ×
                        </button>
                    )}
                </div>
                <div className="profile-bookmarks-line">
                    <span className="settings-field-label">Stream port:</span>
                    <input
                        className="tor-port-input"
                        type="text"
                        value={portValue}
                        onChange={(e) => setPortValue(e.target.value)}
                        onBlur={handlePortBlur}
                        onKeyDown={handlePortKeyDown}
                    />
                </div>
            </div>
        </>
    );
}
```

**5d — Wire into the main render** — in `SettingsPage` component (around line 1404), replace:
```tsx
                <DrawingLibrarySection />

                <hr className="divider" />

                <button className="link-button" onClick={handleOpenSettingsFile}>
```
with:
```tsx
                <DrawingLibrarySection />

                <hr className="divider" />

                <VideoPlayerSection />

                <hr className="divider" />

                <button className="link-button" onClick={handleOpenSettingsFile}>
```

---

## Concerns / Open Questions

All concerns resolved.

| # | Concern | Resolution |
|---|---------|------------|
| C1 | VLC not found — what to show? | `openInVlc` throws `Error("VLC not found. Please set the VLC path in Settings → Video Player.")`. The IPC layer propagates it as a rejected promise. **VideoEditorModel (US-412)** catches the rejection and calls `ui.textDialog({ title: "VLC Not Found", text: "...", readOnly: true })`. No action in US-417. |
| C2 | Windows-only paths | Confirmed — Persephone is Windows-only. No platform guard needed. |
| C3 | `tor-field-label` class name | Rename to `settings-field-label` throughout `SettingsPage.tsx` (3 occurrences). `VideoPlayerSection` uses the renamed class from the start. |

---

## Acceptance Criteria

1. `src/main/vlc-launcher.ts` exists and exports `openInVlc(url, vlcPath?)`:
   - When `vlcPath` is provided and non-empty: spawns that path with `[url]`, detached
   - When `vlcPath` is empty/undefined and VLC exists at a default path: spawns it
   - When VLC cannot be found: throws with the standard error message

2. `api.openInVlc(url, vlcPath)` is callable from the renderer (IPC wired end-to-end)

3. Settings page shows a **Video Player** section with:
   - vlc.exe path field: shows filename or "Auto-detect", browse button, clear button
   - Stream port field: numeric input, validates 1024–65535, reverts on invalid value

4. `tor-field-label` CSS class renamed to `settings-field-label` in `SettingsPage.tsx`; Tor UI unchanged in appearance

5. No lint errors on changed files

---

## Files Changed

| File | Change |
|------|--------|
| `src/main/vlc-launcher.ts` | NEW — `openInVlc` + `resolveVlcPath` |
| `src/ipc/api-types.ts` | Add `openInVlc` to `Endpoint` enum and `Api` type |
| `src/ipc/main/controller.ts` | Add `openInVlc` handler + `bindEndpoint` call |
| `src/ipc/renderer/api.ts` | Add `openInVlc` client method to `ApiCalls` |
| `src/renderer/editors/settings/SettingsPage.tsx` | Rename CSS class (3 occurrences), add `VideoPlayerSection` + wire into render |

## Files That Need NO Changes

- `src/ipc/api-param-types.ts` — no new interface types (all primitives)
- `src/renderer/api/settings.ts` — vlc-path and video-stream.port already added by US-416
- `src/main/video-stream-server.ts` — US-416, complete
- `src/main/main-setup.ts` — no VLC cleanup needed on quit
- Any video editor files — `api.openInVlc()` call + error handling belongs to US-412
