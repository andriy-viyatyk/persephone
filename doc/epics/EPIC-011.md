# EPIC-011: Chrome Extension Support for Built-in Browser

**Status:** Future
**Priority:** Low
**Created:** 2026-03-24

## Goal

Add Chrome extension support to the built-in browser, allowing users to install and use browser extensions (ad blockers, password managers, developer tools, etc.) within js-notepad's browser tabs.

## Background & Research

### How Flow Browser Implements Extensions

[Flow Browser](https://github.com/MultiboxLabs/flow-browser) is an open-source Electron browser that supports Chrome extensions. Key details:

- Uses **Castlabs Electron v39** (same fork as js-notepad) with Widevine DRM
- Uses **`electron-chrome-web-store`** npm package for Chrome Web Store installation UI
- Extensions are **scoped to individual profiles** via custom session routing
- Claims Manifest V3 support (partial — see limitations below)

### Electron's Native Extension API

Electron provides `session.loadExtension(path)` with these **supported Chrome APIs**:
- `chrome.extension`
- `chrome.management`
- `chrome.runtime`
- `chrome.scripting` (fixed in Electron 39)
- `chrome.storage`
- `chrome.tabs`
- `chrome.webRequest`

### electron-chrome-extensions Library

The [`electron-chrome-extensions`](https://www.npmjs.com/package/electron-chrome-extensions) library fills gaps in Electron's native support:

- Adds `chrome.browserAction` (toolbar icons, popups, badges)
- Adds `chrome.cookies`, `chrome.contextMenus`, `chrome.notifications`, `chrome.windows`
- Provides `<browser-action-list>` web component for extension toolbar UI
- Customizable tab/window creation hooks

```typescript
// Main process setup example
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const extensions = new ElectronChromeExtensions({
    session: session.defaultSession,
    createTab: (details) => { /* custom tab logic */ },
    createWindow: (details) => { /* custom window logic */ },
});
extensions.addTab(webContents, browserWindow);
```

### Manifest V2 vs V3 Support

| Feature | V2 | V3 |
|---------|----|----|
| Basic loading | Works | Works (Electron 39+) |
| Background pages | Works | N/A (V3 uses service workers) |
| Service workers | N/A | Works (fixed in Electron 35+) |
| `chrome.scripting` | N/A | Works (fixed in Electron 39) |
| Content scripts | Works | Works |
| `chrome.webRequest` | Conflicts with Electron's native webRequest | Same issue |

**Note:** Electron officially states that full Chrome extension compatibility is a "non-goal." Many extensions work, but some may not — especially those using advanced or newer Chrome APIs.

### Key Challenges

1. **Content script injection scope** — Extensions inject content scripts into ALL webContents in a session. Need session isolation to prevent injection into internal UI (file explorer, settings, etc.)
2. **webRequest conflict** — Electron's native `webRequest` API blocks `chrome.webRequest` listeners. Ad blockers and similar extensions may need workarounds.
3. **Unpacked extensions only** — `.crx` files don't work natively. Must extract to directory path. The `electron-chrome-web-store` package handles this.
4. **No automatic persistence** — `loadExtension()` must be called on every app start. Must persist extension paths to settings.
5. **Per-profile isolation** — Each browser profile needs its own extension set, matching our existing profile/session architecture.

### What js-notepad Already Has

- **Castlabs Electron 39** — Same fork as Flow Browser, has latest MV3 fixes
- **Browser profile/session isolation** — Each profile has its own `session.fromPartition()`
- **Internal tab management** — Browser tabs within a single editor tab
- **Webview-based browser** — Uses `<webview>` tags with session partitions

## Ideas for Implementation

### Phase 1: Basic Extension Loading
- Load unpacked extensions from a configured folder
- Extension toolbar in browser URL bar area
- Persist loaded extension paths per profile
- Session isolation to protect internal UI

### Phase 2: Chrome Web Store Integration
- Integrate `electron-chrome-web-store` for CRX download/install
- Extension manager UI (enable, disable, remove)
- Extension permissions display

### Phase 3: Advanced Features
- Extension popup windows
- Extension context menu items (integrates with our EventChannel system)
- Extension badge/icon updates
- Per-profile extension lists
- Extension settings pages

## Known Limitations to Document

- Not all Chrome extensions will work (Electron is not Chrome)
- Manifest V3 support is partial
- Extensions using `chrome.webRequest` blocking may conflict with Electron
- Performance impact of many extensions unknown
- DRM content + extensions interaction untested

## Related Projects

- [Flow Browser](https://github.com/MultiboxLabs/flow-browser) — Full browser with extension support
- [electron-chrome-extensions](https://github.com/nicktrollmaddock/electron-chrome-extensions) — Chrome API bridge for Electron
- [electron-chrome-web-store](https://www.npmjs.com/package/electron-chrome-web-store) — CRX download/install from Web Store
- [electron-browser-shell](https://github.com/nicktrollmaddock/electron-browser-shell) — Minimal browser shell with extensions

## Tasks

No tasks planned yet. This epic is for future reference when we're ready to implement.
