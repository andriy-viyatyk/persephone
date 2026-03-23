# US-242: nodeFetch — Node.js HTTP Client

## Goal

Add a `nodeFetch` function that makes HTTP requests using Node.js `http`/`https` modules directly, bypassing Chromium's network stack. Full header control, streaming, redirect handling, decompression. Available to scripts via `app.fetch()` and usable by the upcoming Rest Client editor.

## Background

### Why not Chromium's fetch?

Chromium's `fetch()` and Electron's `net.fetch()` automatically inject headers (Origin, User-Agent, Sec-Fetch-*, etc.) that cannot be suppressed. For a REST Client tool and for scripts that need precise header control, we need a raw Node.js HTTP implementation.

### Why renderer process, not main process?

Since js-notepad runs with `nodeIntegration: true`, the renderer process has full access to Node.js `http`/`https` modules. Implementing `nodeFetch` in the renderer avoids IPC overhead and keeps response bodies as streams (IPC would force buffering the entire body for serialization).

### Reference implementation

Proven implementation in `D:\projects\av-player\src\main\network\nodeHttpFetch.ts` — handles redirects, decompression, streaming, timeouts. We'll port this, stripping av-player-specific code (Tor, custom DNS, Firefox TLS ciphers).

### Existing patterns

- **Script API types:** `.d.ts` files in `src/renderer/api/types/` define IntelliSense interfaces
- **App object:** `src/renderer/api/app.ts` exposes services via getters, initialized in `initServices()`
- **Shared code location:** `src/shared/` for code used by both main and renderer processes

## Implementation Plan

### Step 1: Create nodeFetch function
**File:** `src/renderer/api/node-fetch.ts`

Port from `nodeHttpFetch.ts`, keeping:
- Pure Node.js `http`/`https` request logic
- Redirect handling (301, 302, 303, 307, 308) with correct method switching
- Automatic decompression (gzip, deflate, br, zstd)
- Streaming response body via `ReadableStream`
- Configurable timeout (default 30s)
- Returns standard web `Response` object

Removing:
- Custom DNS / DoH lookup — not needed
- Tor agent support — our Tor service works at the session/proxy level
- `mainVar`/`mainEvents` dependencies — av-player specific
- Firefox-like TLS cipher config — use Node defaults
- Console.log redirect logging — use structured approach instead

**Function signature:**
```typescript
export function nodeFetch(
    url: string,
    options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string | ReadableStream | null;
        timeout?: number;
        maxRedirects?: number;
    }
): Promise<Response>
```

**Key decisions:**
- Accept `string` body (convenience for JSON/text) in addition to `ReadableStream`
- Default method: `"GET"`
- Default timeout: `30000` ms
- Default maxRedirects: `10`
- Returns standard `Response` — `.json()`, `.text()`, `.arrayBuffer()`, `.body` (stream) all work

### Step 2: Add script API types
**File:** `src/renderer/api/types/app.d.ts`

Add `fetch` method to `IApp` interface:
```typescript
export interface IApp {
    // ... existing properties ...

    /**
     * Make an HTTP request using Node.js (bypasses Chromium headers).
     * Full header control — no automatic Origin, User-Agent, etc.
     *
     * @example
     * const res = await app.fetch("https://api.example.com/users", {
     *     method: "POST",
     *     headers: { "Content-Type": "application/json", "Authorization": "Bearer token" },
     *     body: JSON.stringify({ name: "John" }),
     * });
     * const data = await res.json();
     */
    fetch(url: string, options?: IFetchOptions): Promise<Response>;
}

export interface IFetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string | ReadableStream | null;
    timeout?: number;
    maxRedirects?: number;
    /** Set to false to skip SSL certificate validation (e.g. self-signed certs). Default: true. */
    rejectUnauthorized?: boolean;
}
```

### Step 3: Expose on app object
**File:** `src/renderer/api/app.ts`

Add a `fetch` method on the App class that delegates to `nodeFetch`:
```typescript
fetch = async (url: string, options?: any): Promise<Response> => {
    const { nodeFetch } = await import("./node-fetch");
    return nodeFetch(url, options);
};
```

Using dynamic import keeps the `http`/`https` modules out of the initial bundle.

### Step 4: Update editor types for IntelliSense
**File:** `assets/editor-types/_imports.txt` (if needed)

Ensure `app.d.ts` changes are picked up by Monaco IntelliSense.

## Design Decisions (resolved)

1. **Naming:** `app.fetch` — clean, intuitive. The "node" prefix is an implementation detail.
2. **Script body type:** Full `ReadableStream` exposed to scripts. Buffering large responses is the developer's responsibility.
3. **SSL validation:** Add `rejectUnauthorized?: boolean` option (default `true`). Scripts testing against self-signed certs can set it to `false`.
4. **Proxy:** Not supported in initial implementation. Can add later via `http-proxy-agent`.

## Acceptance Criteria

- [ ] `nodeFetch` function in `src/renderer/api/node-fetch.ts`
- [ ] Returns standard `Response` object
- [ ] Full header control — no automatic headers added
- [ ] Redirect handling (301, 302, 303, 307, 308)
- [ ] Auto-decompression (gzip, deflate, br, zstd)
- [ ] Streaming response body
- [ ] Configurable timeout
- [ ] `rejectUnauthorized` option for self-signed certs
- [ ] Exposed as `app.fetch()` for scripts
- [ ] IntelliSense types in `app.d.ts`
- [ ] Can be imported directly by the Rest Client editor
