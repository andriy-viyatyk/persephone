# US-228: Browser (Tor) Mode

## Goal

Add a "Browser (Tor)" mode that combines incognito-style ephemeral browsing with routing all traffic through the Tor network via a SOCKS5 proxy. Tor process is managed lazily — starts on first Tor page open, stops when the last Tor page closes.

## Background

### Current browser architecture

The browser editor supports three modes via Electron session partitions:

- **Default:** `persist:browser-default` — persistent cookies/storage
- **Incognito:** `browser-incognito-<UUID>` (no `persist:` prefix) — ephemeral, RAM-only
- **Named profiles:** `persist:browser-<name>` — separate persistent sessions per profile

Key files:
- [BrowserPageModel.ts](src/renderer/editors/browser/BrowserPageModel.ts) — state, partition logic (`getPartitionString()` at line 290), tab management
- [BrowserPageView.tsx](src/renderer/editors/browser/BrowserPageView.tsx) — React component, webview mounting, URL bar
- [browser-service.ts](src/main/browser-service.ts) — main process webContents/session management
- [browser-ipc.ts](src/ipc/browser-ipc.ts) — IPC channel definitions
- [PagesLifecycleModel.ts](src/renderer/api/pages/PagesLifecycleModel.ts) — `showBrowserPage()` at line 599
- [tools-editors-registry.ts](src/renderer/ui/sidebar/tools-editors-registry.ts) — sidebar items at line 105

### How incognito mode works (pattern to follow)

1. Sidebar click calls `pagesModel.showBrowserPage({ incognito: true })`
2. `showBrowserPage` creates model, sets `s.isIncognito = true`
3. `getPartitionString()` returns `browser-incognito-<UUID>` (no `persist:` prefix → no disk storage)
4. `BrowserPageView` uses this partition on the `<webview>` element
5. `getIcon()` returns `IncognitoIcon` instead of `GlobeIcon`
6. URL bar shows `IncognitoIcon` in `startButtons`
7. On dispose, skips `clearCache` (no disk storage to clean)
8. Favicon disk cache and search history are skipped

### Reference: av-player Tor implementation

Source: `D:\projects\av-player\src\main\tor.ts`

- Spawns `tor.exe` with `-f torrc` argument
- Monitors stdout for `"Bootstrapped 100%"` to detect ready state
- Sets `socks5://127.0.0.1:9050` proxy on `session.defaultSession`
- Creates `SocksProxyAgent` for Node.js HTTP requests
- On stop: clears proxy rules, closes all connections, kills process

**Key difference for js-notepad:** We set proxy only on the Tor partition's session (not `defaultSession`), so other browser pages are unaffected.

### Electron session proxy API

```typescript
// Set proxy on a specific partition
const ses = session.fromPartition("browser-tor-<UUID>");
await ses.setProxy({ proxyRules: "socks5h://127.0.0.1:9050" });
await ses.closeAllConnections();
```

The `socks5h://` scheme (with `h`) routes DNS through the SOCKS proxy, preventing DNS leaks.

### Existing UI patterns to reuse

- **Overlay:** Browser already uses absolute-positioned overlays (`webview-click-overlay` z-index 1, `BrowserFindBar` z-index 10, `BookmarksDrawer` z-index 6). Tor status overlay fits at z-index 5 (below find bar, above click guard).
- **Spinner:** `CircularProgress` component at `src/renderer/components/basic/CircularProgress.tsx` — configurable size, rotating animation.
- **Clickable URL bar indicators:** Bookmarks star button toggles the bookmarks drawer. Same pattern for Tor indicator toggling the status overlay.

## Implementation Plan

### Step 1: Settings — Add Tor configuration keys

**File:** `src/renderer/api/settings.ts`

- [ ] Add `"tor.exe-path"` to `AppSettingsKey` type (line 22) — string, default `""`
- [ ] Add `"tor.socks-port"` to `AppSettingsKey` type — number, default `9050`
- [ ] Add defaults in `defaultAppSettingsState.settings` (line 62)
- [ ] Add comments in `settingsComments` (line 44):
  - `"tor.exe-path"`: "Path to tor.exe. Required for Browser (Tor) mode.\nDownload the Tor Expert Bundle or find tor.exe in your Tor Browser installation folder."
  - `"tor.socks-port"`: "SOCKS proxy port for Tor.\nDefault: 9050. Change if port 9050 is already in use."

### Step 2: IPC — Tor channel definitions

**New file:** `src/ipc/tor-ipc.ts`

- [ ] Define `TorChannel` constants:
  - `"tor:start"` — `(torExePath: string, socksPort: number, partition: string) => { success: boolean; error?: string }`
  - `"tor:stop"` — `(partition: string) => void`
  - `"tor:log"` — event channel for streaming Tor stdout to renderer

### Step 3: Main process — Tor service

**New file:** `src/main/tor-service.ts`

- [ ] Create `TorService` class with:
  - `torProcess: ChildProcessWithoutNullStreams | null`
  - `activePartitions: Set<string>` — consumer counter for lazy stop
  - `startPromise` — deduplicates concurrent start requests
  - `running: boolean` — whether tor.exe is bootstrapped and active
- [ ] `startForPartition(torExePath, socksPort, partition)`:
  1. Add partition to `activePartitions`
  2. If Tor already running → just set proxy on the new partition, return `{ success: true }`
  3. If `startPromise` exists (Tor is starting) → await it, then set proxy on partition
  4. If not running → generate torrc if not exists, spawn `tor.exe -f <torrc>`, stream stdout lines to renderer via `TorChannel.log`, wait for "Bootstrapped 100%" (60s timeout)
  5. On success → set proxy on partition, return `{ success: true }`
  6. On failure → remove partition from `activePartitions`, return `{ success: false, error: "<message>" }`
- [ ] `stopForPartition(partition)`:
  1. Clear proxy on partition's session
  2. Remove from `activePartitions`
  3. If `activePartitions` is empty → kill tor.exe process, set `running = false`
- [ ] `shutdown()`: Kill tor.exe immediately (for app quit)
- [ ] `ensureTorrc(socksPort)`: If `<userData>/tor/torrc` does not exist, generate it with:
  ```
  SocksPort <port>
  DataDirectory <userData>/tor/data
  ```
  If it already exists, leave it as-is (user may have customized it).
- [ ] Proxy setup: `session.fromPartition(partition).setProxy({ proxyRules: "socks5h://127.0.0.1:<port>" })`
- [ ] **Log streaming:** On stdout/stderr data from tor.exe, broadcast to all renderer windows via `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(TorChannel.log, line))`
- [ ] Export `initTorHandlers()` — registers `ipcMain.handle` for `TorChannel.start` and `TorChannel.stop`

### Step 4: Register in main-setup.ts

**File:** `src/main/main-setup.ts`

- [ ] Import and call `initTorHandlers()` (alongside `initBrowserHandlers()` at line 41)
- [ ] Add `torService.shutdown()` in `app.on("will-quit")` handler (line 113)

### Step 5: State — Add `isTor` and Tor status to BrowserPageState

**File:** `src/renderer/editors/browser/BrowserPageModel.ts`

- [ ] Add to `BrowserPageState` interface (after `isIncognito` at line 178):
  - `isTor: boolean` — whether this is a Tor browsing session
  - `torStatus: "disconnected" | "connecting" | "connected" | "error"` — current Tor connection state
  - `torLog: string` — accumulated Tor stdout log text
  - `torOverlayVisible: boolean` — whether overlay is shown (ephemeral, not persisted)
- [ ] Defaults in `getDefaultBrowserPageState()` (line 265): `isTor: false`, `torStatus: "disconnected"`, `torLog: ""`, `torOverlayVisible: false`
- [ ] Update `getPartitionString()` (line 290) — add `isTor` and `torId` params:
  ```typescript
  if (isTor) return `browser-tor-${torId || crypto.randomUUID()}`;
  ```
- [ ] Add `private torId = crypto.randomUUID()` (alongside `incognitoId` at line 321)
- [ ] Update `get partition()` getter (line 324) to pass `isTor` and `torId`
- [ ] Add Tor log listener in constructor (only when `isTor`):
  ```typescript
  // Subscribe to Tor log events from main process
  private torLogListener = (_event: any, line: string) => {
      this.state.update(s => { s.torLog += (s.torLog ? "\n" : "") + line; });
  };
  ```
  Register with `ipcRenderer.on(TorChannel.log, this.torLogListener)` — but only after `isTor` is known (in `restore()` or `initTorProxy()`).
- [ ] Add `initTorProxy()` method:
  ```typescript
  async initTorProxy(): Promise<{ success: boolean; error?: string }> {
      this.state.update(s => { s.torStatus = "connecting"; s.torOverlayVisible = true; });
      // Start listening to Tor log
      ipcRenderer.on(TorChannel.log, this.torLogListener);
      const torExePath = settings.get("tor.exe-path");
      const socksPort = settings.get("tor.socks-port");
      const result = await ipcRenderer.invoke(TorChannel.start, torExePath, socksPort, this.partition);
      this.state.update(s => {
          s.torStatus = result.success ? "connected" : "error";
          if (result.error) s.torLog += "\n" + result.error;
          // Auto-hide overlay on success after brief delay
          if (result.success) setTimeout(() => this.state.update(s2 => { s2.torOverlayVisible = false; }), 500);
      });
      return result;
  }
  ```
- [ ] Add `reconnectTor()` method — same as `initTorProxy()` but callable from the overlay "Reconnect" button
- [ ] Add `toggleTorOverlay()` method — toggles `torOverlayVisible`
- [ ] Update `getIcon()` (line 543): Return `TorIcon` when `s.isTor`
- [ ] Update `getRestoreData()` (line 485): Include `isTor` in saved data (but NOT `torStatus`/`torLog`/`torOverlayVisible`)
- [ ] Update `applyRestoreData()` (line 508): Restore `isTor` field. When `isTor`:
  - Set `torStatus = "disconnected"`, `torOverlayVisible = true`
  - Clear all tabs (show page with no open tabs, overlay prompts reconnect)
- [ ] Update `dispose()` (line 402): When `isTor`:
  - Remove Tor log listener: `ipcRenderer.removeListener(TorChannel.log, this.torLogListener)`
  - Invoke `TorChannel.stop` with partition (decrements consumer counter)
  - Skip `clearCache` (no disk storage)
- [ ] Update `getBookmarksFilePath()` (line 337): Return `""` when `isTor`
- [ ] Skip favicon disk cache when `isTor` (line 298, same condition as `isIncognito`)
- [ ] Skip search history when `isTor` (same condition as `isIncognito`)

### Step 6: Tor status overlay component

**New file:** `src/renderer/editors/browser/TorStatusOverlay.tsx`

A styled overlay component shown over the browser content area when Tor is connecting, errored, or user clicks the Tor indicator.

- [ ] **Layout:** Absolute positioned, `inset: 0`, z-index 5 (above webview content, below find bar). Semi-transparent dark background.
- [ ] **Content (centered):**
  - TorIcon (large) + status text
  - When `connecting`: `CircularProgress` spinner + "Connecting to Tor network..."
  - When `connected`: green checkmark + "Connected to Tor"
  - When `error`: red error icon + "Failed to connect"
  - When `disconnected` (after restore): "Tor is not connected" + "Reconnect" button
- [ ] **Log area:** Below the status, a scrollable `<pre>` showing `torLog` text (auto-scrolls to bottom). Always visible during `connecting` state. Toggled by a "Show log" / "Hide log" button in other states.
- [ ] **"Reconnect" button:** Visible when `disconnected` or `error`. Calls `model.reconnectTor()`.
- [ ] **Close button (X):** Top-right corner to dismiss the overlay. Only available when `connected` (not during `connecting`).
- [ ] **Styling:** Use `styled.div` with nested class-based styles (project pattern). Colors from `color` theme tokens.

### Step 7: Page creation — Add `tor` option

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

- [ ] Add `tor?: boolean` to `showBrowserPage` options (line 599)
- [ ] When `tor` is true, validate before creating page:
  1. `settings.get("tor.exe-path")` non-empty → else `ui.notify("Browser (Tor) requires tor.exe path. Configure it in Settings.", "error")` and return
  2. File exists at path → else `ui.notify("tor.exe not found at: <path>", "error")` and return
- [ ] Set `s.isTor = true` on model state
- [ ] After `model.restore()` and `addPage(model)`, call `model.initTorProxy()` (page is visible with overlay while connecting)

### Step 8: Sidebar — Add "Browser (Tor)" entry

**File:** `src/renderer/ui/sidebar/tools-editors-registry.ts`

- [ ] Add entry after `browser-incognito` (line 117):
  ```typescript
  {
      id: "browser-tor",
      label: "Browser (Tor)",
      icon: React.createElement(TorIcon),
      create: () => { pagesModel.showBrowserPage({ tor: true }); },
      category: "tool",
  },
  ```
- [ ] Import `TorIcon` from `language-icons.tsx`

### Step 9: TorIcon

**File:** `src/renderer/theme/language-icons.tsx`

- [ ] Add `TorIcon` — onion-layered SVG using `createIconWithViewBox` pattern
- [ ] Stroke-based, `currentColor`, matching project's icon style
- [ ] Should accept optional `color` prop (same as `GlobeIcon`)

### Step 10: Browser view — Tor indicator and overlay integration

**File:** `src/renderer/editors/browser/BrowserPageView.tsx`

- [ ] Destructure `isTor`, `torStatus`, `torOverlayVisible` from model state (line 420)
- [ ] **Tor indicator in URL bar** `startButtons` when `isTor` (same pattern as incognito, line 553-557):
  - Show `TorIcon` with color based on status: theme default while `connecting`, green when `connected`, red when `error`/`disconnected`
  - Show `CircularProgress` (small, ~12px) next to/instead of icon while `connecting`
  - Make indicator clickable → calls `model.toggleTorOverlay()`
- [ ] Adjust `startButtonsWidth` calculation for the icon
- [ ] **Render `TorStatusOverlay`** inside the browser content area (alongside webview) when `isTor && torOverlayVisible`

## Resolved Concerns

1. **Tor Expert Bundle vs Tor Browser:** No auto-detection. User provides `tor.exe` path manually. User docs will explain where to find `tor.exe` (Tor Browser installation folder or Tor Expert Bundle download).

2. **torrc generation:** Auto-generate in `<userData>/tor/torrc` if it does not exist. If it already exists, leave as-is. Experienced users can find and edit it. Mention path in user docs.

3. **Startup time:** Solved by the Tor status overlay. Overlay shows automatically while connecting with a live log from `tor.exe` stdout and a spinner. Auto-hides on successful connection. User can also click the Tor URL bar indicator to show/hide the overlay at any time.

4. **Multiple Tor pages / consumer counter:** `activePartitions: Set<string>` acts as the consumer counter. Each Tor page adds its partition on start, removes on dispose. Tor process stops only when the set is empty.

5. **Session restore:** Tor pages ARE saved/restored (they have `skipSave = true` inherited? — need to verify). On restore: page opens with no tabs, `torStatus = "disconnected"`, overlay visible with "Reconnect" button. User explicitly reconnects. If `skipSave` prevents restore entirely, this concern is moot.

6. **Port conflict:** The overlay log shows all `tor.exe` output including errors. Port conflict errors from Tor are visible to the user. The configurable `tor.socks-port` setting lets them change the port.

## Acceptance Criteria

- [ ] `"tor.exe-path"` and `"tor.socks-port"` settings appear in Settings page with comments
- [ ] "Browser (Tor)" appears in sidebar with distinct onion icon
- [ ] Clicking it without configuring tor.exe path shows error notification
- [ ] Clicking it with invalid path shows error notification
- [ ] With valid tor.exe path: overlay shows with spinner + live Tor log while connecting
- [ ] After "Bootstrapped 100%": overlay auto-hides, browser is functional
- [ ] Tor indicator in URL bar is clickable → shows/hides the status overlay
- [ ] Tor indicator shows spinner while connecting, green when connected, red on error
- [ ] `https://check.torproject.org` confirms traffic routes through Tor
- [ ] Closing last Tor page stops the tor.exe process (consumer counter)
- [ ] Opening multiple Tor pages shares one tor.exe process
- [ ] App quit kills tor.exe process
- [ ] No data persisted between Tor sessions (ephemeral partition)
- [ ] Non-Tor browser pages are unaffected by Tor proxy
- [ ] After session restore: Tor page shows overlay with "Reconnect" button (not auto-connect)
