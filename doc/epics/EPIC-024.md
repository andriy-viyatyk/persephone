# EPIC-024: Video Player Editor

## Status

**Status:** Completed
**Created:** 2026-04-11
**Completed:** 2026-04-11

## Overview

Add a standalone Video Player editor to Persephone that can play video from URLs — local files, HTTPS links to MP4 files, and M3U8/HLS streams. The player is ported from the [av-player](D:\projects\av-player) project (`VPlayer.tsx`), using **video.js** for controls and **hls.js** for adaptive streaming. No file association — the player opens via a "New Video Player" command or by pasting a video URL.

The editor includes a URL input bar with cURL/fetch parsing (reusing `curl-parser.ts`), format auto-detection, and VLC integration — the user can open the current video in an external VLC player. For VLC and for complex sources (archive entries, custom HTTP headers), a local HTTP streaming server provides a URL with HTTP range request support.

To support video streaming, the existing `IProvider` interface is extended with an optional `createReadStream()` method, and `FileProvider`/`HttpProvider` are updated to support it.

## Goals

- Play MP4 video files from local paths and HTTP/HTTPS URLs
- Play HLS/M3U8 adaptive streams via hls.js
- URL input bar with cURL/fetch command parsing (reuse existing `parseHttpRequest`)
- video.js player controls (play/pause, seek, volume, fullscreen)
- VLC integration — "Open in VLC" button, `vlc-path` setting
- Local HTTP streaming server with range request support for VLC and proxied sources
- Extend `IProvider` with optional streaming API for large binary content

## Reference Implementation

The av-player project at `D:\projects\av-player` contains a working video player:

| Component | File | What to port |
|-----------|------|--------------|
| VPlayer component | `src/renderer/controls/VPlayer.tsx` | video.js + hls.js setup, format detection, event handlers, controls |
| VPlayer types | `src/renderer/controls/VPlayer-types.ts` | `VideoFormat`, `PlayerState`, `detectVideoFormat()` |
| Video player page | `src/renderer/pages/player/VideoPlayer.tsx` | UI layout (URL bar, player area, state badge, VLC button) |
| Video player model | `src/renderer/pages/player/videoPlayerModel.tsx` | State management, URL handling, history |
| Streaming server | `src/main/streaming-server.ts` | HTTP server for VLC, range request support |
| VLC launch | `src/main/streaming-server.ts:58-71` | `openUrlInVLC()` — spawn VLC process |

**What to skip:** Torrent/magnet link support (WebTorrent), M3U playlist parsing, bookmark system, torrent protocol handler — Persephone doesn't have torrent functionality.

**What to adapt:**
- av-player uses `TComponentModel` — Persephone uses `EditorModel` for standalone editors
- av-player stores VLC path in `AppConfig.vlcPath` — Persephone uses `settings.get("vlc-path")`
- av-player creates a dedicated HTTP server on port 8824 — Persephone should extend the existing MCP HTTP server (port 7865) or create a separate lightweight server in main process

## Architecture

### Editor Registration

Standalone editor (like `image-view`, `mcp-view`, `browser-view`) with no file association:

```typescript
// In register-editors.ts
editorRegistry.register({
    id: "video-view",
    name: "Video Player",
    editorType: "videoPage",
    category: "standalone",
    acceptFile: (fileName) => {
        const videoExtensions = [".mp4", ".webm", ".ogg", ".m3u8", ".m3u"];
        if (matchesExtension(fileName, videoExtensions)) return 100;
        return -1;
    },
    loadModule: async () => {
        const module = await import("./video/VideoPlayer");
        return module.default;
    },
});
```

### Editor Model

`VideoEditorModel extends EditorModel<VideoEditorState, void>` — standalone model similar to `ImageEditorModel`:

```typescript
interface VideoEditorState extends IEditorState {
    /** Current video URL (resolved, ready to play). */
    url: string;
    /** Original user input (may be cURL command). */
    inputText: string;
    /** Detected video format. */
    format: VideoFormat;
    /** Current player state. */
    playerState: PlayerState;
    /** Whether player is muted. */
    muted: boolean;
    /** Parsed HTTP request (from cURL). Non-null when custom headers are needed. */
    parsedRequest: ParsedHttpRequest | null;
    /** Navigation history (previous URLs). */
    history: string[];
}
```

Default state:
```typescript
const defaultVideoEditorState: VideoEditorState = {
    type: "videoPage",
    url: "",
    inputText: "",
    format: "mp4",
    playerState: "stopped",
    muted: false,
    parsedRequest: null,
    history: [],
};
```

### Video Playback Component

Port `VPlayer` from av-player, adapting to Persephone patterns:

```typescript
// src/renderer/editors/video/VPlayer.tsx
// Dependencies: video.js, hls.js (new npm packages)

interface VPlayerProps {
    src?: string;
    format?: VideoFormat;
    muted?: boolean;
    onStateChange?: (state: PlayerState, error?: any) => void;
    onMutedChange?: (muted: boolean) => void;
}
```

**Format detection** (ported from `VPlayer-types.ts`):
```typescript
type VideoFormat = "mp4" | "m3u8";  // No "magnet" — torrent not supported
type PlayerState = "stopped" | "loading" | "playing" | "paused" | "unsupported format" | "error";

function detectVideoFormat(src: string): VideoFormat {
    if (src.includes(".m3u8") || src.includes("media-hls.")) return "m3u8";
    return "mp4";
}
```

**Playback logic** (from av-player `VPlayerModel`):
- Initialize video.js player with `controls: true, autoplay: true, preload: "auto"`
- For M3U8: create `Hls` instance with optional custom loader (see HLS Custom Loader section below), `hls.loadSource(src)`, `hls.attachMedia(videoElement)`
- For MP4/other: set `video.src = streamingServerUrl` (always goes through streaming server)
- Event listeners: `loadstart` → loading, `playing` → playing, `pause` → paused, `error` → detect code 4 (unsupported) vs generic error
- `getPicture()` — capture current frame to canvas data URL (for thumbnails)

### URL Input and cURL Parsing

Reuse `parseHttpRequest()` from `src/renderer/core/utils/curl-parser.ts`:

```typescript
// In VideoEditorModel
submitUrl(text: string) {
    const parsed = parseHttpRequest(text);
    if (parsed) {
        // cURL/fetch command detected — use parsed URL and headers
        this.state.update(s => ({
            ...s,
            inputText: text,
            url: parsed.url,
            format: detectVideoFormat(parsed.url),
            parsedRequest: parsed,
        }));
    } else {
        // Plain URL
        this.state.update(s => ({
            ...s,
            inputText: text,
            url: text.trim(),
            format: detectVideoFormat(text.trim()),
            parsedRequest: null,
        }));
    }
}
```

**All sources go through the streaming server** — the `<video>` element always receives a local streaming URL (`http://127.0.0.1:PORT/video-stream/SESSION_ID`). This ensures consistent behavior regardless of source type (local files, HTTP with custom headers, archive entries). No `file://` URLs are used.

**Exception: M3U8/HLS** — hls.js manages its own HTTP fetching (adaptive bitrate, segment requests). For M3U8 URLs, the player passes the URL directly to hls.js (not through the streaming server). When custom headers are needed (from cURL input), hls.js uses a custom `Loader` implementation backed by `nodeFetch` — see the HLS Custom Loader section below.

### HLS Custom Loader (nodeFetch-backed)

**Problem:** M3U8 streams are often protected by headers (`Origin`, `Referer`, `Host`). hls.js fetches both the playlist and every `.ts` segment. Its default XHR loader runs in Chromium's network stack which treats `Origin`/`Referer`/`Host` as **forbidden headers** — `setRequestHeader()` silently ignores them. So `xhrSetup` alone can't solve this.

**Solution:** Replace hls.js's default loader with a custom `NodeFetchLoader` class that uses Persephone's `nodeFetch()` (Node.js http/https, no forbidden header restrictions). This applies to **all** HLS requests — playlist files, segment files, and key files.

**When to use:** Only when `parsedRequest` has custom headers. For plain M3U8 URLs without headers, use the default hls.js loader (standard XHR, zero overhead).

```typescript
// src/renderer/editors/video/NodeFetchHlsLoader.ts

import type Hls from "hls.js";
import type {
    Loader,
    LoaderContext,
    LoaderConfiguration,
    LoaderCallbacks,
    LoaderStats,
    HlsConfig,
} from "hls.js";
import { LoadStats } from "hls.js";

/**
 * hls.js Loader implementation backed by nodeFetch (Node.js http/https).
 *
 * Bypasses Chromium's network stack entirely, so ALL headers including
 * Origin, Referer, and Host are sent as-is. Used when the user provides
 * a cURL command with custom headers for an M3U8 stream.
 */
export function createNodeFetchLoaderClass(
    extraHeaders: Record<string, string>,
): { new (config: HlsConfig): Loader<LoaderContext> } {
    return class NodeFetchLoader implements Loader<LoaderContext> {
        context: LoaderContext | null = null;
        stats: LoaderStats = new LoadStats();
        private controller: AbortController | null = null;

        constructor(private config: HlsConfig) {}

        destroy(): void {
            this.abort();
        }

        abort(): void {
            this.controller?.abort();
            this.controller = null;
        }

        async load(
            context: LoaderContext,
            config: LoaderConfiguration,
            callbacks: LoaderCallbacks<LoaderContext>,
        ): Promise<void> {
            this.context = context;
            this.controller = new AbortController();
            const stats = this.stats;

            stats.loading.start = performance.now();

            // Merge context headers (from hls.js) with extra headers (from cURL)
            const headers: Record<string, string> = {
                ...extraHeaders,
                ...context.headers,
            };

            // Add Range header if hls.js requests a byte range
            if (context.rangeStart !== undefined) {
                const rangeEnd = context.rangeEnd !== undefined
                    ? context.rangeEnd.toString()
                    : "";
                headers["Range"] = `bytes=${context.rangeStart}-${rangeEnd}`;
            }

            try {
                const { nodeFetch } = await import("../../api/node-fetch");
                const response = await nodeFetch(context.url, {
                    method: "GET",
                    headers,
                });

                if (!response.ok) {
                    callbacks.onError(
                        { code: response.status, text: response.statusText },
                        context,
                        response,
                        stats,
                    );
                    return;
                }

                stats.loading.first = performance.now();
                stats.total = parseInt(
                    response.headers.get("content-length") || "0",
                    10,
                );

                const data = context.responseType === "arraybuffer"
                    ? await response.arrayBuffer()
                    : await response.text();

                stats.loaded = typeof data === "string"
                    ? data.length
                    : data.byteLength;
                stats.loading.end = performance.now();

                callbacks.onSuccess(
                    { url: context.url, data },
                    stats,
                    context,
                    response,
                );
            } catch (error: any) {
                if (error.name === "AbortError") {
                    stats.aborted = true;
                    callbacks.onAbort?.(stats, context, null);
                    return;
                }
                callbacks.onError(
                    { code: 0, text: error.message },
                    context,
                    null,
                    stats,
                );
            }
        }

        getCacheAge(): number | null {
            return null;
        }

        getResponseHeader(_name: string): string | null {
            return null;
        }
    };
}
```

**Usage in VPlayer:**
```typescript
// When creating Hls instance:
if (format === "m3u8" && Hls.isSupported()) {
    const hlsConfig: Partial<HlsConfig> = {};

    // Use custom loader only when custom headers exist
    if (parsedRequest?.headers && Object.keys(parsedRequest.headers).length > 0) {
        hlsConfig.loader = createNodeFetchLoaderClass(parsedRequest.headers);
    }

    this.hls = new Hls(hlsConfig);
    this.hls.loadSource(url);
    this.hls.attachMedia(this.video);
}
```

**Key design points:**
- `createNodeFetchLoaderClass(headers)` returns a **class** (not an instance) — hls.js calls `new config.loader(config)` internally for each request
- Extra headers from `parsedRequest` are captured in the closure — every playlist fetch and segment fetch gets them
- hls.js's own `context.headers` are merged on top (e.g., hls.js may set `Accept` headers)
- `Range` header is built from `context.rangeStart`/`rangeEnd` when hls.js requests byte ranges
- `nodeFetch` is dynamically imported (consistent with Persephone's lazy-loading pattern)
- No streaming server involvement for HLS — Node.js handles all HTTP directly in the renderer process

### IProvider Streaming Extension

Add optional streaming method to the `IProvider` interface:

```typescript
// In io.provider.d.ts — add to IProvider interface
export interface IProvider {
    // ... existing methods ...
    
    /**
     * Create a readable stream from the source with optional byte range.
     * Used for large binary content (video, audio) where loading the full
     * buffer into memory is impractical.
     * Optional — providers that don't support streaming fall back to readBinary().
     */
    createReadStream?(range?: { start: number; end: number }): NodeJS.ReadableStream;
}
```

**FileProvider** — add `createReadStream()`:
```typescript
// In FileProvider.ts
createReadStream(range?: { start: number; end: number }): NodeJS.ReadableStream {
    const options = range ? { start: range.start, end: range.end } : undefined;
    return nodefs.createReadStream(this.filePath, options);
}
```

**HttpProvider** — add `createReadStream()`:
```typescript
// In HttpProvider.ts
createReadStream(range?: { start: number; end: number }): NodeJS.ReadableStream {
    // Uses node http/https directly (not nodeFetch) for streaming
    // Sets Range header if range provided: "bytes=start-end"
    // Returns the response stream (with decompression if needed)
    // Note: does NOT cache the response (unlike readBinary)
}
```

### Local Video Streaming Server

A lightweight HTTP server in the main process that serves video content with HTTP range request support. Needed for:
1. **VLC playback** of any source (VLC opens `http://127.0.0.1:PORT/video-stream/SESSION_ID`)
2. **In-app playback** of sources requiring custom headers (cURL-parsed requests)
3. **Archive entries** — video files inside ZIP/RAR/7z

**Location:** `src/main/video-stream-server.ts` (separate from MCP server)

**Architecture:**
```
GET /video-stream/:sessionId
    → Look up session (source URL, headers, file path, etc.)
    → Get file/resource size (stat or HEAD request)
    → Parse Range header from request
    → Create read stream with range
    → Respond with 206 Partial Content + correct headers
```

**Session management:**
- Renderer creates a session via IPC: `ipc.createVideoStreamSession({ url, headers?, filePath? })`
- Main process stores session config, returns session ID
- Streaming URL: `http://127.0.0.1:${port}/video-stream/${sessionId}`
- Sessions auto-expire after inactivity (e.g., 30 minutes)

**Response headers:**
```
Content-Type: video/mp4 (or video/webm, application/vnd.apple.mpegurl for m3u8)
Accept-Ranges: bytes
Content-Length: <chunk-size>
Content-Range: bytes <start>-<end>/<total>
```

**Port:** Separate port with a default (e.g., `7866`) configurable via `video-stream.port` setting (placed next to VLC path in Settings UI). Separate from MCP server to keep concerns isolated.

### VLC Integration

**Settings:**
```typescript
// In settings.ts — add to AppSettingsKey:
"vlc-path"
"video-stream.port"

// In defaultAppSettingsState:
"vlc-path": ""          // Default: empty (auto-detect common paths)
"video-stream.port": 7866  // Default streaming server port
```

**Default VLC path detection:**
```typescript
const DEFAULT_VLC_PATHS = [
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
];
```

**VLC launch** (ported from av-player):
```typescript
// In main process (via IPC)
function openInVlc(url: string): void {
    const vlcPath = getVlcPath();  // From settings or default paths
    if (!vlcPath) throw new Error("VLC path not configured");
    
    const proc = require("child_process").spawn(vlcPath, [url], {
        detached: true,
        stdio: "ignore",
    });
    proc.unref();
}
```

**Flow for "Open in VLC":**
1. User clicks "Open in VLC" button in video player toolbar
2. If source is a plain URL (no custom headers): pass URL directly to VLC
3. If source needs proxying (custom headers, archive): create streaming session → pass streaming URL to VLC
4. Spawn VLC process with the URL

### UI Layout

```
┌─────────────────────────────────────────────────────┐
│ [◀ Back] [URL input bar..................] [▶ Play] │  ← Toolbar
├─────────────────────────────────────────────────────┤
│                                                     │
│              ┌───────────────────┐                  │
│              │                   │                  │
│              │   video.js player │                  │
│              │   (controls bar)  │                  │
│              │                   │                  │
│              └───────────────────┘                  │
│                                                     │
│         [state badge: loading/error/...]            │
│         [Open in VLC]  (when not playing)           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- **URL input:** Text field with Enter to submit. Accepts plain URLs or cURL commands.
- **Back button:** Navigate URL history (stack-based, like av-player)
- **State badge:** Shows player state (loading, error, unsupported format). Hidden when playing.
- **VLC button:** Bottom-center, visible when video is in error/stopped state. Also available as toolbar button.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-412](../tasks/US-412-video-player-shell/README.md) | Video player standalone editor — model, registration, UI shell | Active |
| [US-413](../tasks/US-413-video-playback-component/README.md) | Video playback component (video.js + hls.js) | Active |
| [US-414](../tasks/US-414-url-input-curl-parsing/README.md) | URL input with cURL parsing and format detection | Active |
| [US-415](../tasks/US-415-iprovider-streaming/README.md) | IProvider streaming extension (readStream + range support) | Active |
| [US-416](../tasks/US-416-video-stream-server/README.md) | Local video streaming server for VLC and proxied sources | Active |
| [US-417](../tasks/US-417-vlc-integration/README.md) | VLC integration — settings and launch | Active |

## Resolved Concerns

All concerns reviewed and decided on 2026-04-11:

| # | Concern | Decision |
|---|---------|----------|
| C1 | video.js + hls.js bundle size | Not a concern — the entire video editor is lazy-loaded as a standalone editor module (dynamic import). video.js/hls.js are only imported within that module, so they're automatically code-split. No additional lazy loading needed. |
| C2 | video.js CSS conflicts | Accept the risk. Will test UI during implementation and fix conflicts if any appear. |
| C3 | Electron `file://` in `<video>` | **All sources go through the streaming server**, including local files (via IContentPipe + FileProvider.createReadStream). No `file://` URLs used in video elements. This gives consistent behavior and enables range-request seeking for all sources. |
| C4 | HTTP range requests for `HttpProvider.createReadStream()` | Handle gracefully — fall back to streaming the full response if server doesn't support `206 Partial Content`. |
| C5 | Streaming server port collision | Use a default port (`7866`) with a configurable `video-stream.port` setting next to VLC path in Settings UI. |
| C6 | VLC path on non-Windows platforms | Windows only — no cross-platform logic. Persephone is a Windows app; other platform-specific code already exists. |
| C7 | Large file memory usage | Streaming is mandatory. `IProvider.createReadStream()` enables the streaming server to serve large files without loading them into memory. Video playback starts as soon as the first chunk is ready — no waiting for full download. |
| C8 | DRM-protected HLS streams | Out of scope. hls.js handles unencrypted HLS only. DRM (Widevine EME) can be added later if needed. |
| C9 | cURL-parsed requests with custom auth | Accept — auth tokens stored in memory-only session objects, cleaned up on session expiry (30 min inactivity). No persistence risk. |
| C10 | M3U8 streams with protected headers | hls.js's default XHR loader can't set forbidden headers (Origin, Referer, Host). Solution: custom `NodeFetchLoader` class backed by `nodeFetch()` (Node.js http/https, no restrictions). Only used when `parsedRequest` has headers; plain M3U8 URLs use the default loader. |

## Notes

### 2026-04-11
- Epic created based on user's av-player project and Persephone architecture review
- All 10 concerns reviewed and resolved
- **Key decision:** All video sources go through the streaming server (no `file://` URLs) — consistent behavior, range-request seeking for everything
- **Key decision:** Streaming server on separate configurable port (`video-stream.port` setting, default 7866)
- **Key decision:** Windows only — no cross-platform VLC path detection
- **Key dependency:** video.js (^8.23.4) + hls.js (^1.6.13) — same versions used in av-player
- **Pattern:** Standalone editor like ImageViewer/MCP Inspector — `EditorModel` subclass, no `TextFileModel`, no file content persistence
- **Content pipeline extension:** `IProvider.createReadStream()` is the main infrastructure change. It benefits video streaming but also lays groundwork for any large-file handling in the future.
- **Streaming is mandatory for usability** — video must start playing when first chunk arrives, not after full download
- **Streaming server:** Separate from MCP server to keep concerns isolated. MCP handles tool calls; video server handles byte-range streaming.
- **VLC integration:** All sources get a streaming URL. VLC always receives `http://127.0.0.1:PORT/video-stream/SESSION_ID`.
- **HLS with custom headers (C10):** Custom `NodeFetchLoader` class replaces hls.js's default XHR loader when headers are present. Captures cURL headers in a closure, used for every playlist and segment fetch. `nodeFetch` bypasses Chromium's forbidden header restrictions. Only activated when `parsedRequest.headers` is non-empty.
- **Skipped from av-player:** WebTorrent/magnet links, torrent protocol handler, M3U playlist parsing, bookmark system, network proxy — none of these exist in Persephone
- **curl-parser.ts** already handles both cURL bash/cmd and fetch() syntax — no parser changes needed
- **node-fetch.ts** already wraps Node streams as web ReadableStream with decompression — can be reused for HttpProvider.createReadStream()
