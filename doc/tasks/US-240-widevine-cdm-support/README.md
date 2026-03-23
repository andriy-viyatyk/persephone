# US-240: Widevine CDM Support for Built-in Browser

## Goal

Enable DRM-protected video playback (Netflix, Disney+, etc.) in the built-in browser by switching from standard Electron to the Castlabs Electron for Content Security (ECS) fork, which includes Widevine CDM support.

## Background

### The Problem
The built-in browser shows error M7701-1003 when attempting to play Netflix videos. Standard Electron does not include Widevine CDM support — the `enable_widevine` build flag is disabled at compile time, and the `--widevine-cdm-path` command-line switch is silently ignored.

### Why borrowing Chrome's CDM doesn't work
We initially tried loading Chrome/Edge's Widevine CDM binary via `app.commandLine.appendSwitch('widevine-cdm-path', ...)`. This approach fails because standard Electron is compiled without Widevine support — the CDM loading code is not present in the binary. The switches are accepted but do nothing.

### The Solution: Castlabs Electron
[Castlabs Electron for Content Security (ECS)](https://github.com/castlabs/electron-releases) is a fork of Electron that:
- Is a **drop-in replacement** for standard Electron
- Has Widevine CDM support compiled in (`enable_widevine=true`)
- Downloads the CDM automatically via the Component Updater Service
- Provides a `components` API to wait for CDM installation
- Actively maintained with releases tracking standard Electron versions

### Available Castlabs Electron 39.x builds
- `v39.8.0+wvcus` (March 5, 2026)
- `v39.5.1+wvcus` (February 4, 2026)
- `v39.2.7+wvcus` (January 8, 2026)

Our current Electron version: `39.2.4`

### The only code change needed
```javascript
const { app, components, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
    await components.whenReady();  // <-- ensures CDM is downloaded
    // ... rest of startup
});
```

### VMP (Verified Media Path) Signing
- **Development:** Castlabs releases come **pre-signed** — no signing needed
- **Production:** Applications must be signed using Castlabs' EVS service or a VMP certificate
- EVS signing eliminates the need for a Google Widevine license agreement
- Signing must happen: on Windows **after** code-signing, on macOS **before** code-signing

## Implementation Plan

### Step 1: Replace Electron with Castlabs Electron
**File:** `package.json`

Replace the `electron` dev dependency with the Castlabs fork:
```json
"electron": "https://github.com/castlabs/electron-releases#v39.8.0+wvcus"
```

Run `npm install` and verify the app starts normally.

### Step 2: Add `components.whenReady()` to app startup
**File:** `src/main/main-setup.ts`

In the `app.on("ready")` handler, await `components.whenReady()` before proceeding:
```typescript
import { components } from "electron";

app.on("ready", async () => {
    await components.whenReady();
    console.log("Widevine CDM status:", components.status());
    registerAssetProtocol(appPartition);
    // ... rest of ready handler
});
```

### Step 3: Verify DRM playback works
Test on:
- Netflix (https://www.netflix.com)
- Bitmovin DRM demo (https://bitmovin.com/demos/drm/)

### Step 4: Update build configuration for production
**Files:** `electron-builder.yml`, potentially `forge.config.ts`

Ensure the production build uses the Castlabs Electron binary. May need to configure electron-builder to use the Castlabs download mirror.

### Step 5: Investigate VMP signing for production
Research and document the EVS signing process for production builds. This may be a follow-up task if the process is complex.

## Concerns / Open Questions

1. **VMP signing for production builds:** Development works without signing, but production builds need VMP signing via Castlabs EVS service. Need to understand the process, cost, and integration with our build pipeline. This could be a blocker for shipping.

2. **Electron Forge compatibility:** We use Electron Forge for dev mode. Need to verify Castlabs Electron works with Forge's dev server.

3. **electron-builder compatibility:** Production builds use electron-builder. Need to verify it can download/use the Castlabs binary instead of standard Electron.

4. **Update cadence:** When we update Electron, we'll need to match Castlabs releases. They typically release within days of standard Electron releases.

5. **TypeScript types:** Castlabs adds the `components` module to Electron. Their package includes updated `electron.d.ts` types, but need to verify this works with our TypeScript setup.

6. **CDM download timing:** `components.whenReady()` downloads the CDM on first launch. This requires internet access and may add a delay. Need to handle the case where download fails (e.g., offline).

## Acceptance Criteria

- [ ] Castlabs Electron replaces standard Electron in package.json
- [ ] `components.whenReady()` called before window creation
- [ ] Netflix videos play successfully in the built-in browser
- [ ] App starts and functions normally (no regressions from Electron swap)
- [ ] Dev mode works with Electron Forge
- [ ] Production build works with electron-builder
- [ ] VMP signing process documented (even if not automated yet)
