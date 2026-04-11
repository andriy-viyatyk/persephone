# US-416: Local video streaming server for VLC and proxied sources

## Goal

Create a lightweight HTTP server in the main process that serves video content with range request support, accessible through session-based URLs (`http://127.0.0.1:PORT/video-stream/SESSION_ID`). All video sources (local files, HTTP URLs with custom headers) go through this server so the `<video>` element and VLC always receive a standard HTTP URL with seekable byte-range support.

## Background

### Why a streaming server is needed

The Video Player editor (EPIC-024) plays video from three source types:
1. Local files — `file://` URLs don't work reliably in `<video>` for seeking; use local HTTP instead
2. HTTP URLs with default headers — could use directly, but routing through a server gives consistency
3. HTTP URLs with custom auth headers (from cURL input) — browser can't set forbidden headers (`Origin`, `Referer`, `Host`) on `<video>` src; main process HTTP can

VLC always needs an HTTP URL (it can't receive a stream in-process). So every source gets wrapped in a session that the streaming server knows how to read.

### Exception: M3U8/HLS sources

M3U8 streams are passed directly to hls.js (not through the streaming server). When custom headers are needed, US-413's `NodeFetchHlsLoader` handles them. The streaming server is for MP4 / direct video sources only.

### IPC pattern in Persephone

All renderer→main communication goes through three files:

| Layer | File | Purpose |
|-------|------|---------|
| Type definitions | `src/ipc/api-types.ts` | `Endpoint` enum + `Api` type |
| Parameter types | `src/ipc/api-param-types.ts` | Request/response types |
| Main handler | `src/ipc/main/controller.ts` | `bindEndpoint()` registration + implementation |
| Renderer client | `src/ipc/renderer/api.ts` | `executeOnce<T>(Endpoint.xxx, ...)` calls |

Pattern seen with `setMcpEnabled(enabled, port?)`: the renderer reads the port from settings and passes it to IPC. The main process uses the received port value.

### Reference implementations

- `src/main/mcp-http-server.ts` — HTTP server in main process, session management pattern, lazy SDK loading with dynamic import
- `src/renderer/api/node-fetch.ts` — Node.js http/https client; **renderer-only**; main process must use `http`/`https` modules directly (no web API wrapping needed in main)
- `D:\projects\av-player\src\main\streaming-server.ts` — Reference streaming server (torrent-focused); see `openUrlInVLC()` for VLC spawn pattern

### Settings pattern

`src/renderer/api/settings.ts`:
- `AppSettingsKey` union type — all setting keys listed here
- `settingsComments` — human-readable comment written into the JSON settings file
- `defaultAppSettingsState.settings` — default values
- Renderer accesses via `settings.get("key")` and `settings.set("key", value)`

Existing analog: `"mcp.port"` (number) and `"tor.exe-path"` (string path).

### Architecture constraint: main process cannot call IProvider

The streaming server lives in the main process and cannot call renderer-side `IProvider.createReadStream()`. It reads sources independently:
- **File paths**: Node.js `fs.createReadStream(path, { start, end })`
- **HTTP URLs**: Node.js `http.request()` / `https.request()` with Range header forwarding

## Implementation plan

### Step 1 — Add setting keys to `src/renderer/api/settings.ts`

**File:** `src/renderer/api/settings.ts`

Add to the `AppSettingsKey` type (after `"tor.bookmarks-file"`):

```typescript
// Before:
| "tor.bookmarks-file";

// After:
| "tor.bookmarks-file"
| "vlc-path"
| "video-stream.port";
```

Add to `settingsComments` (after the `"tor.bookmarks-file"` entry):

```typescript
// Before:
"tor.bookmarks-file": "Path to the .link.json bookmarks file for Browser (Tor) mode.",

// After:
"tor.bookmarks-file": "Path to the .link.json bookmarks file for Browser (Tor) mode.",
"vlc-path": "Path to VLC executable.\nLeave empty to auto-detect C:\\Program Files\\VideoLAN\\VLC\\vlc.exe.",
"video-stream.port": "Port for the local video streaming server.\nUsed by the video player for VLC integration and proxied HTTP sources. Default: 7866.",
```

Add to `defaultAppSettingsState.settings` (after the `"tor.bookmarks-file"` entry):

```typescript
// Before:
"tor.bookmarks-file": "",

// After:
"tor.bookmarks-file": "",
"vlc-path": "",
"video-stream.port": 7866,
```

### Step 2 — Add IPC types to `src/ipc/api-param-types.ts`

Append to the end of the file:

```typescript
export interface VideoStreamSessionConfig {
    /** Local file path to stream. Mutually exclusive with url. */
    filePath?: string;
    /** HTTP/HTTPS URL to proxy. Mutually exclusive with filePath. */
    url?: string;
    /** Custom request headers forwarded to the source URL. */
    headers?: Record<string, string>;
    /** HTTP method for the source request. Defaults to "GET". */
    method?: string;
    /**
     * Owner page ID. When provided, deleteVideoStreamSessionsByPage() will
     * destroy all sessions for this page — call it from the editor's dispose().
     */
    pageId?: string;
}

export interface VideoStreamSessionResult {
    sessionId: string;
    streamingUrl: string;
}
```

### Step 3 — Add endpoints to `src/ipc/api-types.ts`

**File:** `src/ipc/api-types.ts`

Add to `Endpoint` enum (after `startScreenSnip`):

```typescript
// Before:
startScreenSnip = "startScreenSnip",

// After:
startScreenSnip = "startScreenSnip",
createVideoStreamSession = "createVideoStreamSession",
deleteVideoStreamSession = "deleteVideoStreamSession",
```

Add to `Api` type (after `startScreenSnip` line):

```typescript
// Before:
[Endpoint.startScreenSnip]: () => Promise<string | null>;

// After:
[Endpoint.startScreenSnip]: () => Promise<string | null>;
[Endpoint.createVideoStreamSession]: (config: VideoStreamSessionConfig, port?: number) => Promise<VideoStreamSessionResult>;
[Endpoint.deleteVideoStreamSession]: (sessionId: string) => Promise<void>;
```

Also add the new types to the import at the top of `api-types.ts`:

```typescript
// Before:
import {
    CommonFolder,
    DownloadEntry,
    OpenFileDialogParams,
    OpenFolderDialogParams,
    RuntimeVersions,
    SaveFileDialogParams,
    UpdateCheckResult,
} from "./api-param-types";

// After:
import {
    CommonFolder,
    DownloadEntry,
    OpenFileDialogParams,
    OpenFolderDialogParams,
    RuntimeVersions,
    SaveFileDialogParams,
    UpdateCheckResult,
    VideoStreamSessionConfig,
    VideoStreamSessionResult,
} from "./api-param-types";
```

### Step 4 — Create `src/main/video-stream-server.ts` (NEW)

Full implementation:

```typescript
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VideoStreamSessionConfig, VideoStreamSessionResult } from "../ipc/api-param-types";

const DEFAULT_PORT = 7866;
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

interface SessionData {
    config: VideoStreamSessionConfig;
    lastAccessed: number;
}

const sessions = new Map<string, SessionData>();
let httpServer: http.Server | undefined;
let currentPort = DEFAULT_PORT;
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

// ── Public API ──────────────────────────────────────────────────────

export async function createSession(
    config: VideoStreamSessionConfig,
    port = DEFAULT_PORT,
): Promise<VideoStreamSessionResult> {
    await ensureServerRunning(port);
    const sessionId = randomUUID();
    sessions.set(sessionId, { config, lastAccessed: Date.now() });
    return {
        sessionId,
        streamingUrl: `http://127.0.0.1:${currentPort}/video-stream/${sessionId}`,
    };
}

export function deleteSession(sessionId: string): void {
    sessions.delete(sessionId);
}

export function stopVideoStreamServer(): void {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = undefined;
    }
    httpServer?.close();
    httpServer = undefined;
    sessions.clear();
}

// ── Server lifecycle ────────────────────────────────────────────────

async function ensureServerRunning(port: number): Promise<void> {
    if (httpServer?.listening) return;

    currentPort = port;
    httpServer = http.createServer(handleRequest);

    // Expire idle sessions every 5 minutes
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [id, session] of sessions) {
            if (now - session.lastAccessed > SESSION_EXPIRY_MS) {
                sessions.delete(id);
            }
        }
    }, 5 * 60 * 1000);

    await new Promise<void>((resolve, reject) => {
        httpServer!.once("error", reject);
        httpServer!.listen(port, "127.0.0.1", resolve);
    });
}

// ── Request handler ─────────────────────────────────────────────────

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Add CORS headers so the renderer can load the video
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const match = req.url?.match(/^\/video-stream\/([^/?]+)/);
    if (!match) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
    }

    const sessionId = match[1];
    const session = sessions.get(sessionId);

    if (!session) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Session not found or expired");
        return;
    }

    session.lastAccessed = Date.now();
    const rangeHeader = req.headers.range;
    const { config } = session;

    const onError = (err: Error) => {
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end(err.message || "Internal Server Error");
        } else if (!res.writableEnded) {
            res.destroy(err);
        }
    };

    if (config.filePath) {
        handleFileRequest(config.filePath, rangeHeader, res).catch(onError);
    } else if (config.url) {
        handleHttpRequest(config, rangeHeader, res).catch(onError);
    } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid session config: no filePath or url");
    }
}

// ── File source ─────────────────────────────────────────────────────

async function handleFileRequest(
    filePath: string,
    rangeHeader: string | undefined,
    res: http.ServerResponse,
): Promise<void> {
    const stat = await fs.promises.stat(filePath);
    const totalSize = stat.size;
    const contentType = getContentTypeFromPath(filePath);

    if (rangeHeader) {
        const range = parseRangeHeader(rangeHeader, totalSize);
        if (!range) {
            res.writeHead(416, {
                "Content-Range": `bytes */${totalSize}`,
            });
            res.end();
            return;
        }

        const { start, end } = range;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
            "Content-Type": contentType,
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.on("error", (err) => {
            if (!res.writableEnded) res.destroy(err);
        });
        stream.pipe(res);
    } else {
        res.writeHead(200, {
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Content-Length": totalSize,
        });

        const stream = fs.createReadStream(filePath);
        stream.on("error", (err) => {
            if (!res.writableEnded) res.destroy(err);
        });
        stream.pipe(res);
    }
}

// ── HTTP source ─────────────────────────────────────────────────────

async function handleHttpRequest(
    config: VideoStreamSessionConfig,
    rangeHeader: string | undefined,
    res: http.ServerResponse,
): Promise<void> {
    const { url, headers: customHeaders = {}, method = "GET" } = config;

    // Don't accept content-encoding: main process serves raw bytes to video player
    const requestHeaders: Record<string, string> = {
        ...customHeaders,
        "Accept-Encoding": "identity",
    };

    if (rangeHeader) {
        requestHeaders["Range"] = rangeHeader;
    }

    const sourceResponse = await makeHttpRequest(url!, method, requestHeaders);
    const statusCode = sourceResponse.statusCode ?? 200;

    // Forward relevant response headers
    const forwardHeaders: Record<string, string | number> = {
        "Accept-Ranges": "bytes",
    };

    const contentType = sourceResponse.headers["content-type"];
    if (contentType) forwardHeaders["Content-Type"] = Array.isArray(contentType) ? contentType[0] : contentType;

    const contentLength = sourceResponse.headers["content-length"];
    if (contentLength) forwardHeaders["Content-Length"] = Array.isArray(contentLength) ? contentLength[0] : contentLength;

    const contentRange = sourceResponse.headers["content-range"];
    if (contentRange) forwardHeaders["Content-Range"] = Array.isArray(contentRange) ? contentRange[0] : contentRange;

    res.writeHead(statusCode, forwardHeaders);
    sourceResponse.on("error", (err) => {
        if (!res.writableEnded) res.destroy(err);
    });
    sourceResponse.pipe(res);
}

// ── HTTP request helper ─────────────────────────────────────────────

function makeHttpRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    redirectsLeft = 10,
): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === "https:";
        const lib: typeof http | typeof https = isHttps ? https : http;

        const options: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port ? parseInt(urlObj.port, 10) : (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method,
            headers,
        };

        const req = lib.request(options, (res) => {
            const status = res.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
                const location = res.headers.location;
                if (!location || redirectsLeft <= 0) {
                    res.destroy();
                    reject(new Error(location ? "Too many redirects" : "Redirect without Location"));
                    return;
                }
                res.resume(); // drain redirect body
                const redirectUrl = location.startsWith("http")
                    ? location
                    : new URL(location, url).toString();
                const redirectMethod = status === 303 ? "GET" : method;
                makeHttpRequest(redirectUrl, redirectMethod, headers, redirectsLeft - 1)
                    .then(resolve, reject);
                return;
            }
            resolve(res);
        });

        req.on("error", reject);
        req.end();
    });
}

// ── Utilities ───────────────────────────────────────────────────────

function getContentTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".mp4":  return "video/mp4";
        case ".webm": return "video/webm";
        case ".ogg":  return "video/ogg";
        case ".mkv":  return "video/x-matroska";
        case ".m3u8": return "application/vnd.apple.mpegurl";
        case ".ts":   return "video/mp2t";
        default:      return "application/octet-stream";
    }
}

function parseRangeHeader(
    rangeHeader: string,
    totalSize: number,
): { start: number; end: number } | null {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return null;

    const [, startStr, endStr] = match;
    let start: number;
    let end: number;

    if (!startStr && endStr) {
        // Suffix range: bytes=-500 means last 500 bytes
        const suffixLen = parseInt(endStr, 10);
        start = Math.max(0, totalSize - suffixLen);
        end = totalSize - 1;
    } else {
        start = startStr ? parseInt(startStr, 10) : 0;
        end = endStr ? parseInt(endStr, 10) : totalSize - 1;
    }

    if (start > end || start >= totalSize) return null;
    end = Math.min(end, totalSize - 1);

    return { start, end };
}
```

### Step 5 — Add IPC handlers to `src/ipc/main/controller.ts`

**Add import** to existing `api-param-types` import (line 6):

```typescript
// Before:
import { DownloadEntry, OpenFileDialogParams, RuntimeVersions, SaveFileDialogParams, UpdateCheckResult } from "../api-param-types";

// After:
import { DownloadEntry, OpenFileDialogParams, RuntimeVersions, SaveFileDialogParams, UpdateCheckResult, VideoStreamSessionConfig, VideoStreamSessionResult } from "../api-param-types";
```

**Add handler methods** to the `Controller` class (after `startScreenSnip`):

```typescript
createVideoStreamSession = async (
    event: IpcMainEvent,
    config: VideoStreamSessionConfig,
    port?: number,
): Promise<VideoStreamSessionResult> => {
    const { createSession } = await import("../../main/video-stream-server");
    return createSession(config, port);
};

deleteVideoStreamSession = async (event: IpcMainEvent, sessionId: string): Promise<void> => {
    const { deleteSession } = await import("../../main/video-stream-server");
    deleteSession(sessionId);
};
```

**Register endpoints** in the `init()` function (after `startScreenSnip`):

```typescript
// Before:
bindEndpoint(Endpoint.startScreenSnip, controllerInstance.startScreenSnip);

// After:
bindEndpoint(Endpoint.startScreenSnip, controllerInstance.startScreenSnip);
bindEndpoint(Endpoint.createVideoStreamSession, controllerInstance.createVideoStreamSession);
bindEndpoint(Endpoint.deleteVideoStreamSession, controllerInstance.deleteVideoStreamSession);
```

### Step 6 — Add client calls to `src/ipc/renderer/api.ts`

**Add import** to existing `api-param-types` import (first import line):

```typescript
// Before:
import {
    CommonFolder,
    DownloadEntry,
    OpenFileDialogParams,
    OpenFolderDialogParams,
    RuntimeVersions,
    SaveFileDialogParams,
    UpdateCheckResult,
} from "../api-param-types";

// After:
import {
    CommonFolder,
    DownloadEntry,
    OpenFileDialogParams,
    OpenFolderDialogParams,
    RuntimeVersions,
    SaveFileDialogParams,
    UpdateCheckResult,
    VideoStreamSessionConfig,
    VideoStreamSessionResult,
} from "../api-param-types";
```

**Add client methods** to the `ApiCalls` class (after `startScreenSnip`):

```typescript
createVideoStreamSession = async (config: VideoStreamSessionConfig, port?: number) => {
    return executeOnce<VideoStreamSessionResult>(Endpoint.createVideoStreamSession, config, port);
};

deleteVideoStreamSession = async (sessionId: string) => {
    return executeOnce<void>(Endpoint.deleteVideoStreamSession, sessionId);
};
```

### Step 7 — Stop server on app quit in `src/main/main-setup.ts`

**Add import** at top (after `stopMcpHttpServer` import):

```typescript
// Before:
import { stopMcpHttpServer } from "./mcp-http-server";

// After:
import { stopMcpHttpServer } from "./mcp-http-server";
import { stopVideoStreamServer } from "./video-stream-server";
```

**Add to `will-quit` handler**:

```typescript
// Before:
app.on("will-quit", () => {
    torService.shutdown();
    stopPipeServer();
    stopMcpHttpServer();
});

// After:
app.on("will-quit", () => {
    torService.shutdown();
    stopPipeServer();
    stopMcpHttpServer();
    stopVideoStreamServer();
});
```

## Concerns

**C1: Port already in use**
If port 7866 is taken, `httpServer.listen()` rejects, and the IPC call throws. The video editor model (US-412) should catch this error and display it in the player UI. For now this is documented as expected behavior — the user can change `video-stream.port` in settings.

**C2: HTTP source without Content-Length**
Some HTTP servers don't return `Content-Length`. In that case the streaming server will proxy a 200 response with no `Content-Length`. The video player can still play from the start, but cannot seek beyond already-downloaded data. This is acceptable for the initial implementation.

**C3: Port change while server is running**
If `video-stream.port` is changed in settings while the server is running, the new port takes effect on the next app start (same behavior as `mcp.port`). There's no live restart mechanism. This is acceptable — same behavior as MCP.

**C4: `Accept-Encoding: identity` for HTTP sources**
The streaming server forces `Accept-Encoding: identity` when proxying HTTP sources. This prevents gzip-compressed responses, ensuring the byte offsets in Range headers correspond to real content bytes. Most video servers already serve uncompressed video, so this has no practical downside.

**C5: no `MainApi` constraint in controller.ts**
The `Controller` class implements `MainApi` which is derived from `Api` type. Adding handlers without updating the `Api` type first would cause a TypeScript error on the class. Steps 3 and 5 are ordered correctly — Step 3 updates `Api`, Step 5 adds the handlers.

## Acceptance criteria

- [ ] `api.createVideoStreamSession({ filePath: "C:\\test.mp4" })` returns `{ sessionId, streamingUrl: "http://127.0.0.1:7866/video-stream/UUID" }`
- [ ] `GET http://127.0.0.1:7866/video-stream/SESSION_ID` without Range header returns 200 with full file content and `Accept-Ranges: bytes`
- [ ] `GET` with `Range: bytes=0-1023` returns 206 with correct `Content-Range` header and exactly 1024 bytes
- [ ] `GET` with an expired/unknown session ID returns 404
- [ ] HTTP source sessions forward the `Range` header to the upstream and proxy the 206 response
- [ ] `api.deleteVideoStreamSession(sessionId)` removes the session; subsequent GET returns 404
- [ ] `api.deleteVideoStreamSessionsByPage(pageId)` removes all sessions tagged with that page ID; call from `VideoEditorModel.dispose()`
- [ ] App quit closes the HTTP server cleanly (no port leak on restart)
- [ ] `settings.get("vlc-path")` returns `""` (empty string default)
- [ ] `settings.get("video-stream.port")` returns `7866` (number default)

## Files changed summary

| File | Change |
|------|--------|
| `src/renderer/api/settings.ts` | Add `"vlc-path"` and `"video-stream.port"` settings keys, defaults, and comments |
| `src/ipc/api-param-types.ts` | Add `VideoStreamSessionConfig` and `VideoStreamSessionResult` interfaces |
| `src/ipc/api-types.ts` | Add `createVideoStreamSession` and `deleteVideoStreamSession` to enum and `Api` type |
| `src/main/video-stream-server.ts` | **NEW** — HTTP streaming server with session management, file + HTTP source support, range requests |
| `src/ipc/main/controller.ts` | Add IPC handler methods and register them in `init()` |
| `src/ipc/renderer/api.ts` | Add client call methods |
| `src/main/main-setup.ts` | Add `stopVideoStreamServer()` to `will-quit` handler |

## Files that need NO changes

- `src/renderer/content/providers/FileProvider.ts` — already complete from US-415
- `src/renderer/content/providers/HttpProvider.ts` — already complete from US-415
- `src/renderer/api/types/io.provider.d.ts` — already complete from US-415
- `src/renderer/api/node-fetch.ts` — renderer-only; main process uses native `http`/`https` directly
- `src/main/mcp-http-server.ts` — separate server on separate port; not touched
- `src/main/pipe-server.ts` — unrelated
- Any editor files (`src/renderer/editors/video/`) — those are US-412, US-413, US-414
