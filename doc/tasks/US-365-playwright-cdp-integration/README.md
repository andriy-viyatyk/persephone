# US-365: Playwright-core CDP Integration

## Goal

Integrate `playwright-core` with Persephone's built-in browser webviews via Chrome DevTools Protocol. This is the foundation for all browser automation — subsequent tasks (US-366 through US-370) build on this infrastructure.

## Background

### CDP connection options investigated

**Option A: `--remote-debugging-port` + `connectOverCDP`**
- Playwright's standard approach: open a debugging port, connect via HTTP/WebSocket
- Problems: opens a network port (security concern for healthcare use case), Electron 30+ rejects `--remote-debugging-port` as CLI flag (must use `app.commandLine.appendSwitch`), port is app-wide (not per-webview)
- **Rejected** — security and compatibility concerns

**Option B: Electron `webContents.debugger` API directly**
- `wc.debugger.attach("1.3")` enables CDP on a specific webContents
- `wc.debugger.sendCommand(method, params)` sends CDP commands and returns results
- No port needed, no WebSocket, works per-webview
- But Playwright's `connectOverCDP` needs a URL — can't use this API directly
- **Viable as standalone** — if we don't need Playwright's full API

**Option C: Hybrid — `playwright-core` for selector engine + Electron `debugger` for transport**
- Use `playwright-core`'s **selector engine** and **action helpers** as a library
- Use Electron's `wc.debugger` API as the CDP transport
- Get Playwright's battle-tested logic without needing a network port
- **Recommended approach** — needs investigation of playwright-core internals

### Electron debugger API

Available on `WebContents` in the main process (confirmed in `electron.d.ts:7451-7582`):

```typescript
// Attach CDP — must be called before sendCommand
wc.debugger.attach("1.3");

// Send any CDP command
const result = await wc.debugger.sendCommand("Runtime.evaluate", {
    expression: "document.title"
});

// Listen for CDP events
wc.debugger.on("message", (event, method, params, sessionId) => {
    // e.g. "Page.loadEventFired", "Network.requestWillBeSent"
});

// Detach when done
wc.debugger.detach();

// Check status
wc.debugger.isAttached(); // boolean
```

### Current browser-service.ts infrastructure

`registrations` Map holds `RegisteredWebview` with `webContents: WebContents` per webview. Key is `${tabId}/${internalTabId}`. The `webContents` is obtained via `webContents.fromId(webContentsId)` during registration.

### playwright-core package

- Size: ~10.5 MB (no bundled browsers)
- License: Apache 2.0 (compatible with MIT)
- Contains: selector engines, action implementations, CDP protocol bindings, accessibility tree generation

## Implementation Plan

### Phase 1: Direct CDP via Electron debugger (start here)

This gives us a working foundation immediately, without the complexity of Playwright integration. Playwright-core integration can be layered on top later if needed.

### Step 1: Add IPC channels for CDP session management

**File: `src/ipc/browser-ipc.ts`**

Add new channels:
```typescript
/** Renderer → Main (invoke): attach CDP debugger to a webview. Args: (key: string) */
cdpAttach: "browser:cdp-attach",
/** Renderer → Main (invoke): detach CDP debugger. Args: (key: string) */
cdpDetach: "browser:cdp-detach",
/** Renderer → Main (invoke): send CDP command. Args: (key: string, method: string, params?: object) */
cdpSend: "browser:cdp-send",
```

### Step 2: Implement CDP session management in main process

**File: `src/main/cdp-service.ts`** (new file)

Manages CDP debugger sessions per webview:

```typescript
import { ipcMain, WebContents } from "electron";
import { BrowserChannel } from "../ipc/browser-ipc";

// Track which webContents have an attached debugger
const attachedDebuggers = new WeakSet<WebContents>();

export function initCdpHandlers(
    getWebContents: (key: string) => WebContents | undefined,
): void {
    ipcMain.handle(BrowserChannel.cdpAttach, async (_event, key: string) => {
        const wc = getWebContents(key);
        if (!wc || wc.isDestroyed()) return false;
        if (attachedDebuggers.has(wc)) return true; // already attached
        try {
            wc.debugger.attach("1.3");
            attachedDebuggers.add(wc);
            wc.debugger.on("detach", () => {
                attachedDebuggers.delete(wc);
            });
            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle(BrowserChannel.cdpDetach, async (_event, key: string) => {
        const wc = getWebContents(key);
        if (!wc || wc.isDestroyed()) return;
        if (!attachedDebuggers.has(wc)) return;
        try {
            wc.debugger.detach();
            attachedDebuggers.delete(wc);
        } catch {
            // already detached
        }
    });

    ipcMain.handle(
        BrowserChannel.cdpSend,
        async (_event, key: string, method: string, params?: object) => {
            const wc = getWebContents(key);
            if (!wc || wc.isDestroyed()) throw new Error("WebContents not found");
            if (!attachedDebuggers.has(wc)) {
                // Auto-attach on first command
                wc.debugger.attach("1.3");
                attachedDebuggers.add(wc);
            }
            return wc.debugger.sendCommand(method, params);
        },
    );
}
```

### Step 3: Wire up in browser-service.ts

**File: `src/main/browser-service.ts`**

```typescript
import { initCdpHandlers } from "./cdp-service";

// At end of initBrowserHandlers():
initCdpHandlers((key: string) => {
    const reg = registrations.get(key);
    return reg && !reg.webContents.isDestroyed() ? reg.webContents : undefined;
});
```

### Step 4: Create CdpSession wrapper in renderer

**File: `src/renderer/editors/browser/CdpSession.ts`** (new file)

Thin wrapper that calls CDP commands via IPC:

```typescript
const { ipcRenderer } = require("electron");
import { BrowserChannel } from "../../../ipc/browser-ipc";

/**
 * CDP session wrapper for a browser webview.
 * Sends Chrome DevTools Protocol commands via IPC to the main process.
 */
export class CdpSession {
    constructor(private readonly regKey: string) {}

    async attach(): Promise<boolean> {
        return ipcRenderer.invoke(BrowserChannel.cdpAttach, this.regKey);
    }

    async detach(): Promise<void> {
        return ipcRenderer.invoke(BrowserChannel.cdpDetach, this.regKey);
    }

    async send(method: string, params?: object): Promise<any> {
        return ipcRenderer.invoke(BrowserChannel.cdpSend, this.regKey, method, params);
    }

    // --- Convenience methods ---

    async evaluate(expression: string): Promise<any> {
        const result = await this.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text || "Evaluation failed");
        }
        return result.result?.value;
    }

    /** Get accessibility tree snapshot. */
    async getAccessibilityTree(): Promise<any> {
        return this.send("Accessibility.getFullAXTree");
    }
}
```

### Step 5: Expose on BrowserEditorFacade

**File: `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`**

Add a method to get a CDP session:

```typescript
import { CdpSession } from "../../editors/browser/CdpSession";

// In BrowserEditorFacade class:

/** Get a CDP session for the active tab. */
cdp(): CdpSession {
    const state = this.model.state.get();
    const regKey = `${this.model.id}/${state.activeTabId}`;
    return new CdpSession(regKey);
}

/** Run JavaScript in the page and return the result. */
async evaluate(expression: string): Promise<any> {
    return this.cdp().evaluate(expression);
}
```

**File: `src/renderer/api/types/browser-editor.d.ts`**

Add to `IBrowserEditor`:
```typescript
/** Run JavaScript in the page and return the result. */
evaluate(expression: string): Promise<any>;
```

### Step 6: Smoke test

Verify the integration works with a simple script:

```javascript
const browser = await page.asBrowser();
browser.navigate("https://example.com");
// Wait for load...
const title = await browser.evaluate("document.title");
console.log(title); // "Example Domain"
```

### Phase 2: Playwright-core integration (future, if needed)

If direct CDP proves insufficient (e.g., selector engine complexity, auto-wait logic), add `playwright-core` as a dependency and explore using its internal CDP client with our Electron debugger transport. This would be a separate task.

## Edge Cases

- **Multiple CDP attach calls:** `attachedDebuggers` WeakSet prevents double-attach. Second call returns `true` (already attached).
- **WebContents destroyed:** All handlers check `wc.isDestroyed()` before operating.
- **Debugger already attached by DevTools:** If user opened DevTools (F12), the debugger may already be attached. `wc.debugger.attach()` will throw — catch and handle gracefully.
- **Auto-attach on first command:** `cdpSend` auto-attaches if not yet attached, so explicit `cdpAttach` is optional.
- **Cleanup on tab close:** When `unregisterWebview()` runs, the webContents is destroyed, which auto-detaches the debugger. No explicit cleanup needed.

## Files Changed

| File | Change |
|------|--------|
| `src/ipc/browser-ipc.ts` | Add `cdpAttach`, `cdpDetach`, `cdpSend` channels |
| `src/main/cdp-service.ts` | **New file** — CDP session management in main process |
| `src/main/browser-service.ts` | Import and call `initCdpHandlers()` |
| `src/renderer/editors/browser/CdpSession.ts` | **New file** — renderer-side CDP session wrapper |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Add `evaluate()` and `cdp()` methods |
| `src/renderer/api/types/browser-editor.d.ts` | Add `evaluate()` to `IBrowserEditor` |

### Files NOT changed

- `src/main/network-logger.ts` — independent
- `src/renderer/editors/browser/BrowserEditorModel.ts` — no changes needed
- `src/renderer/editors/browser/BrowserWebviewModel.ts` — CDP goes through main process, not webview element
- `package.json` — no new dependencies in Phase 1 (playwright-core deferred to Phase 2)

## Acceptance Criteria

- [ ] CDP debugger can be attached to any registered webview via IPC
- [ ] CDP commands can be sent and results returned to renderer
- [ ] `browser.evaluate(expression)` works from scripts
- [ ] Auto-attach on first command (no explicit attach needed)
- [ ] Works on hidden (`display: none`) tabs
- [ ] Graceful handling when DevTools already attached
- [ ] Cleanup on tab close (no leaked debugger sessions)
- [ ] Smoke test: navigate + evaluate returns page title
