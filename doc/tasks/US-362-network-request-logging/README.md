# US-362: Network Request Logging in Main Process

## Goal

Add HTTP request/response logging to browser webview sessions in the main process. Use Electron's `session.webRequest` API to capture URL, method, headers, request body, response status, and resource type for every HTTP/HTTPS request. Store logs in a per-session circular buffer and expose them to the renderer via IPC.

## Background

### Electron webRequest API

`session.webRequest` provides non-blocking interceptors per session:

**`onBeforeSendHeaders(filter, listener)`** — fires before request is sent:
```typescript
interface OnBeforeSendHeadersListenerDetails {
    id: number;              // Unique per session, for correlating with onCompleted
    url: string;
    method: string;
    requestHeaders: Record<string, string>;
    uploadData?: UploadData[];  // Request body
    resourceType: 'mainFrame' | 'subFrame' | 'stylesheet' | 'script' | 'image' |
                  'font' | 'object' | 'xhr' | 'ping' | 'cspReport' | 'media' | 'webSocket' | 'other';
    referrer: string;
    timestamp: number;
}
```

**`onCompleted(filter, listener)`** — fires when response is complete:
```typescript
interface OnCompletedListenerDetails {
    id: number;
    url: string;
    method: string;
    responseHeaders?: Record<string, string[]>;
    statusCode: number;
    statusLine: string;
    fromCache: boolean;
    resourceType: string;
}
```

**`UploadData`** — request body:
```typescript
interface UploadData {
    bytes: Buffer;       // Content being sent
    blobUUID?: string;   // UUID for blob data (use ses.getBlobData())
    file?: string;       // Path of file being uploaded
}
```

For `fetch()` POST with JSON body, `bytes` contains the raw body. For form submissions, `bytes` contains URL-encoded form data.

### Existing session hooks

`browser-service.ts` already hooks `session-created` (line 520) for User-Agent cleanup. `download-service.ts` (line 20) also hooks it with a `WeakSet` guard to avoid double-hooking. We follow the same pattern.

### Filter

Use `{ urls: ["http://*/*", "https://*/*"] }` to only intercept HTTP/HTTPS requests (skip `app-asset://`, `file://`, etc.).

### Partition context

Browser partitions:
- `persist:browser-${profileName}` — regular (persistent)
- `browser-incognito-${uuid}` — incognito (ephemeral)
- `browser-tor-${uuid}` — Tor (ephemeral, proxied via SOCKS5)

`webRequest` listeners work transparently with all partition types, including Tor-proxied sessions. No special handling needed.

## Implementation Plan

### Step 1: Define types and IPC channel

**File: `src/ipc/browser-ipc.ts`**

Add the IPC channel:
```typescript
/** Renderer → Main (invoke): get network request log for a browser tab. Args: (key: string) */
getNetworkLog: "browser:get-network-log",
```

Add shared types (in same file, after existing interfaces):
```typescript
/** A logged network request/response pair. */
export interface NetworkLogEntry {
    id: number;
    url: string;
    method: string;
    resourceType: string;
    referrer: string;
    timestamp: number;
    requestHeaders: Record<string, string>;
    requestBody?: string;        // Decoded from uploadData bytes (for POST/PUT/etc)
    statusCode?: number;         // Filled by onCompleted
    statusLine?: string;         // Filled by onCompleted
    responseHeaders?: Record<string, string[]>;  // Filled by onCompleted
    fromCache?: boolean;         // Filled by onCompleted
    error?: string;              // Filled by onErrorOccurred
}
```

### Step 2: Implement network logger in main process

**File: `src/main/network-logger.ts`** (new file)

Separate module to keep `browser-service.ts` focused. Logs are stored **per page** (per registration key `tabId/internalTabId`), not per session. This way each browser tab gets its own log that is cleared when the tab closes.

The `onBeforeSendHeaders` details include `webContentsId` which we match against registered webviews to find the owning page. All requests from a `<webview>` (including from iframes inside it) share the same guest `webContents`, so matching works for iframe requests too.

```typescript
import { Session, ipcMain, WebContents } from "electron";
import { BrowserChannel, NetworkLogEntry } from "../ipc/browser-ipc";

const MAX_LOG_ENTRIES = 200;

/** Per-page (registration key) circular buffer of network log entries. */
const pageLogs = new Map<string, NetworkLogEntry[]>();

/** Per-page pending request map (request id → entry reference). */
const pagePending = new Map<string, Map<number, NetworkLogEntry>>();

/** Sessions already hooked — prevent double-hooking. */
const hookedSessions = new WeakSet<Session>();

/**
 * Resolves a webContentsId to its registration key.
 * Called from browser-service.ts which owns the registrations map.
 */
let resolveWebContentsId: (wcId: number) => string | undefined = () => undefined;

/** Set the resolver function. Called once from browser-service.ts. */
export function setWebContentsResolver(
    resolver: (wcId: number) => string | undefined,
): void {
    resolveWebContentsId = resolver;
}

const MAX_BODY_SIZE = 100 * 1024; // 100 KB — skip larger bodies

/** Decode request body from uploadData. Returns undefined if empty or too large. */
function decodeBody(uploadData?: Electron.UploadData[]): string | undefined {
    if (!uploadData || uploadData.length === 0) return undefined;
    try {
        const buffers = uploadData.filter(d => d.bytes).map(d => d.bytes);
        if (buffers.length === 0) return undefined;
        const totalSize = buffers.reduce((sum, b) => sum + b.length, 0);
        if (totalSize > MAX_BODY_SIZE) return undefined;
        return Buffer.concat(buffers).toString("utf-8");
    } catch {
        return undefined;
    }
}

/**
 * Attach webRequest listeners to a session for network logging.
 * Idempotent via WeakSet guard.
 */
function hookSession(ses: Session): void {
    if (hookedSessions.has(ses)) return;
    hookedSessions.add(ses);

    const filter = { urls: ["http://*/*", "https://*/*"] };

    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        // Resolve which page this request belongs to
        const key = details.webContentsId != null
            ? resolveWebContentsId(details.webContentsId)
            : undefined;

        if (key) {
            // Ensure log and pending map exist for this page
            if (!pageLogs.has(key)) {
                pageLogs.set(key, []);
                pagePending.set(key, new Map());
            }

            const log = pageLogs.get(key)!;
            const pending = pagePending.get(key)!;

            const entry: NetworkLogEntry = {
                id: details.id,
                url: details.url,
                method: details.method,
                resourceType: details.resourceType,
                referrer: details.referrer,
                timestamp: details.timestamp,
                requestHeaders: { ...details.requestHeaders },
                requestBody: decodeBody(details.uploadData),
            };

            // Circular buffer: remove oldest if at capacity
            if (log.length >= MAX_LOG_ENTRIES) {
                const removed = log.shift()!;
                pending.delete(removed.id);
            }

            pending.set(details.id, entry);
            log.push(entry);
        }

        // Pass through unchanged
        callback({ requestHeaders: details.requestHeaders });
    });

    ses.webRequest.onCompleted(filter, (details) => {
        const key = details.webContentsId != null
            ? resolveWebContentsId(details.webContentsId)
            : undefined;
        if (!key) return;

        const pending = pagePending.get(key);
        const entry = pending?.get(details.id);
        if (entry) {
            entry.statusCode = details.statusCode;
            entry.statusLine = details.statusLine;
            entry.responseHeaders = details.responseHeaders;
            entry.fromCache = details.fromCache;
            pending!.delete(details.id);
        }
    });

    ses.webRequest.onErrorOccurred(filter, (details) => {
        const key = details.webContentsId != null
            ? resolveWebContentsId(details.webContentsId)
            : undefined;
        if (!key) return;

        const pending = pagePending.get(key);
        const entry = pending?.get(details.id);
        if (entry) {
            entry.error = details.error;
            pending!.delete(details.id);
        }
    });
}

/**
 * Clear the network log for a page. Called when webview is unregistered.
 */
export function clearNetworkLog(key: string): void {
    pageLogs.delete(key);
    pagePending.delete(key);
}

/**
 * Initialize network logging. Call once during app startup.
 */
export function initNetworkLogger(): void {
    const { app } = require("electron");
    app.on("session-created", (ses: Session) => {
        hookSession(ses);
    });

    // IPC handler: renderer requests network log for a page
    ipcMain.handle(BrowserChannel.getNetworkLog, (_event, key: string) => {
        return pageLogs.get(key) ?? [];
    });
}
```

### Step 3: Wire up initialization and resolver

**File: `src/main/browser-service.ts`**

Add imports at top:
```typescript
import { initNetworkLogger, setWebContentsResolver, clearNetworkLog } from "./network-logger";
```

At the end of `initBrowserHandlers()`, initialize the logger and provide the resolver:
```typescript
initNetworkLogger();

// Provide the resolver that maps webContentsId → registration key
setWebContentsResolver((wcId: number) => {
    for (const [key, reg] of registrations) {
        if (!reg.webContents.isDestroyed() && reg.webContents.id === wcId) {
            return key;
        }
    }
    return undefined;
});
```

### Step 3b: Clear log when webview is unregistered

**File: `src/main/browser-service.ts`**

In `unregisterWebview()`, after deleting the registration, clear its network log:

```typescript
function unregisterWebview(key: string) {
    const reg = registrations.get(key);
    if (!reg) return;

    // Remove all event listeners
    for (const { event: eventName, handler } of reg.listeners) {
        try {
            if (!reg.webContents.isDestroyed()) {
                (reg.webContents as any).removeListener(eventName, handler);
            }
        } catch {
            // webContents may already be destroyed
        }
    }

    registrations.delete(key);

    // Clear network log for this page
    clearNetworkLog(key);
}
```

### Step 4: Edge cases

- **`onBeforeSendHeaders` callback is required** — must call `callback({ requestHeaders: details.requestHeaders })` to pass through unchanged. Without the callback, requests hang.
- **Pending map uses entry references** (not indices) — avoids stale index issues when `log.shift()` removes the oldest entry.
- **Blob uploads:** `uploadData` may contain `blobUUID` without `bytes`. For simplicity, skip blob bodies (they're typically large file uploads, not useful as cURL). The `decodeBody()` helper filters to entries with `bytes`.
- **Binary bodies:** `Buffer.toString("utf-8")` may produce garbage for binary uploads. For logging purposes this is acceptable — the cURL builder (US-363) can detect and skip binary bodies.
- **Log cleanup on page close:** Logs are per registration key (`tabId/internalTabId`). When `unregisterWebview()` is called, it calls `clearNetworkLog(key)` which deletes both the log array and the pending map for that page. Simple and immediate.
- **Resolver performance:** The resolver iterates all registrations to find a webContentsId match. With typically <20 open browser tabs, this is negligible. If it becomes a bottleneck, add a `Map<number, string>` (wcId → key) maintained on register/unregister.
- **`session-created` fires for all sessions**, including the main app session and asset protocol sessions. These won't have browser traffic matching `http://*/*`, so the listeners will never fire — no filtering needed.
- **Unresolved requests:** If `resolveWebContentsId` returns `undefined` (e.g., requests from popup windows not tracked in registrations), the request is silently skipped — no log entry created.

## Files Changed

| File | Change |
|------|--------|
| `src/ipc/browser-ipc.ts` | Add `getNetworkLog` channel + `NetworkLogEntry` interface |
| `src/main/network-logger.ts` | **New file** — network logging service |
| `src/main/browser-service.ts` | Import and call `initNetworkLogger()` |

### Files NOT changed

- `src/main/tor-service.ts` — Tor proxy is transparent to webRequest
- `src/main/download-service.ts` — independent, no interaction
- `src/renderer/editors/browser/*` — renderer changes are in US-363
- `src/renderer/content/*` — content pipeline changes are in US-363/US-364

## Acceptance Criteria

- [ ] `onBeforeSendHeaders` and `onCompleted` listeners attached to all browser sessions
- [ ] Request body captured from `uploadData.bytes` for POST/PUT requests
- [ ] Response status and headers captured from `onCompleted`
- [ ] Network errors captured from `onErrorOccurred`
- [ ] Per-page circular buffer with max 200 entries
- [ ] Renderer can fetch logs via `ipcRenderer.invoke(BrowserChannel.getNetworkLog, key)` where key is `tabId/internalTabId`
- [ ] Works with regular, incognito, and Tor sessions
- [ ] No interference with existing request flow (passthrough only)
- [ ] No performance impact on browsing (listeners are non-blocking)
- [ ] Log cleared when browser tab is closed (unregisterWebview)
