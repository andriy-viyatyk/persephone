# US-415: IProvider streaming extension (readStream + range support)

## Goal

Add an optional `createReadStream()` method to the `IProvider` interface and implement it in `FileProvider` and `HttpProvider`. This enables large binary content (video files) to be served as a byte-range stream without loading the entire file into memory — a prerequisite for the local video streaming server (US-416).

## Background

### Current state

`IProvider` currently exposes `readBinary(): Promise<Buffer>` as the only data-read method. For video files (often hundreds of MB or multi-GB), buffering the full content into memory is impractical. The streaming server in US-416 needs to answer HTTP range requests (`Range: bytes=0-1048575`) with partial content (`206 Partial Content`) — which requires reading a slice of the source without touching the rest.

### Files to modify

| File | Role |
|------|------|
| `src/renderer/api/types/io.provider.d.ts` | IProvider interface declaration |
| `src/renderer/content/providers/FileProvider.ts` | Local file provider |
| `src/renderer/content/providers/HttpProvider.ts` | HTTP/HTTPS URL provider |

### Existing patterns used

- `FileProvider` already has `const nodefs = require("fs")` at line 6 — reuse it for `createReadStream()`.
- `HttpProvider` already does `import("../../api/node-fetch")` dynamically inside `readBinary()` — same pattern for `createReadStream()`.
- `nodeFetch` returns a `Response` whose body is a **web `ReadableStream`** (already handles redirects, decompression). We need to convert it to a **`NodeJS.ReadableStream`** using a `PassThrough` stream.

### Architecture note (open concern resolved at EPIC level)

The streaming server (US-416) will be in the **main process**. Main process cannot directly call renderer-side `IProvider.createReadStream()`. US-416 will manage its own reading logic (see US-416 scope). US-415 adds `createReadStream()` to renderer providers regardless — it establishes the abstraction and is useful for any future in-renderer streaming use case. No architectural conflict.

## Implementation Plan

### Step 1 — Add `createReadStream` to `IProvider` interface

**File:** `src/renderer/api/types/io.provider.d.ts`

Add after the `readBinary()` line (line 41):

```typescript
// BEFORE:
    /** Read binary content from the source. */
    readBinary(): Promise<Buffer>;
    /** Write binary content to the source. Only present if writable. */
    writeBinary?(data: Buffer): Promise<void>;

// AFTER:
    /** Read binary content from the source. */
    readBinary(): Promise<Buffer>;
    /**
     * Create a readable stream from the source with an optional byte range.
     * Used for large binary content (video, audio) where loading the full
     * buffer into memory is impractical.
     * Optional — providers that do not support streaming should omit this method.
     * The range end is inclusive (same as the HTTP Range header convention).
     */
    createReadStream?(range?: { start: number; end: number }): NodeJS.ReadableStream;
    /** Write binary content to the source. Only present if writable. */
    writeBinary?(data: Buffer): Promise<void>;
```

### Step 2 — Implement `createReadStream` in `FileProvider`

**File:** `src/renderer/content/providers/FileProvider.ts`

Add after `readBinary()` (after line 28). `nodefs` is already imported at line 6.

```typescript
// BEFORE (after readBinary, before writeBinary):
    async writeBinary(data: Buffer): Promise<void> {

// AFTER:
    createReadStream(range?: { start: number; end: number }): NodeJS.ReadableStream {
        const options = range ? { start: range.start, end: range.end } : undefined;
        return nodefs.createReadStream(this.filePath, options);
    }

    async writeBinary(data: Buffer): Promise<void> {
```

`nodefs.createReadStream(path, { start, end })` — Node.js built-in, end is inclusive, matches HTTP Range semantics exactly.

### Step 3 — Implement `createReadStream` in `HttpProvider`

**File:** `src/renderer/content/providers/HttpProvider.ts`

Add after `readBinary()` (after line 58, before `toDescriptor`).

`createReadStream()` must be synchronous (returns a stream, not a Promise). Use a `PassThrough` stream as a conduit — initiate the async HTTP request immediately and pipe chunks through as they arrive.

```typescript
// BEFORE (after readBinary, before toDescriptor):
    toDescriptor(): IProviderDescriptor {

// AFTER:
    createReadStream(range?: { start: number; end: number }): NodeJS.ReadableStream {
        const { PassThrough } = require("stream") as typeof import("stream");
        const passThrough = new PassThrough();

        const headers: Record<string, string> = { ...this.headers };
        if (range) {
            headers["Range"] = `bytes=${range.start}-${range.end}`;
        }

        import("../../api/node-fetch")
            .then(({ nodeFetch }) => nodeFetch(this.url, { method: this.method, headers }))
            .then((response) => {
                if (!response.ok && response.status !== 206) {
                    passThrough.destroy(
                        new Error(`HTTP ${response.status}: ${response.statusText}`),
                    );
                    return;
                }
                if (!response.body) {
                    passThrough.end();
                    return;
                }
                const reader = response.body.getReader();
                const pump = (): void => {
                    reader.read().then(({ done, value }) => {
                        if (done) {
                            passThrough.end();
                            return;
                        }
                        passThrough.write(Buffer.from(value), () => pump());
                    }).catch((err) => passThrough.destroy(err));
                };
                pump();
            })
            .catch((err) => passThrough.destroy(err));

        return passThrough;
    }

    toDescriptor(): IProviderDescriptor {
```

**What this does:**
- Returns a `PassThrough` stream synchronously.
- Fires async fetch immediately (no laziness — caller can start reading right away).
- Sends `Range: bytes=start-end` if range is provided; omits the header for a full stream.
- Converts the web `ReadableStream` body (from `nodeFetch`) to Node.js stream chunks via `pump()`.
- On HTTP error (not 2xx and not 206), destroys the stream with an error.
- Does **not** cache — unlike `readBinary()`, streaming is intentionally non-caching.

## Concerns

### C1 — Backpressure in `HttpProvider.createReadStream`

`passThrough.write(chunk, callback)` calls the callback when the chunk has been flushed. Calling `pump()` in the callback naturally respects backpressure (next read happens only after the previous write was flushed). This is correct — no special drain handling needed.

### C2 — `require("stream")` in renderer

`require("stream")` is a Node.js built-in available in Persephone's renderer process (nodeIntegration: true). The `path` and `fs` restrictions in CLAUDE.md do not apply to `stream`. `require("stream")` is acceptable here.

### C3 — `HttpProvider` redirect handling

`nodeFetch` handles redirects automatically (up to 10 by default). `createReadStream` inherits this behavior through `nodeFetch`.

### C4 — Server returns `200` when range requested

Some servers ignore `Range` headers and respond with `200 OK` instead of `206 Partial Content`. The implementation accepts both `response.ok` (2xx including 200) and `206`. When the server returns 200, `createReadStream` streams the full response — the caller (streaming server in US-416) handles the content-range mismatch.

## Acceptance Criteria

1. `FileProvider.createReadStream()` (no range) — returns a readable stream of the entire file.
2. `FileProvider.createReadStream({ start: 0, end: 1023 })` — returned stream contains exactly bytes 0–1023 (1024 bytes) of the file.
3. `HttpProvider.createReadStream()` (no range) — returns a stream of the full HTTP response body; no `Range` header sent.
4. `HttpProvider.createReadStream({ start: 0, end: 1023 })` — sends `Range: bytes=0-1023` in the request; response body streams correctly.
5. TypeScript compiles without errors (`IProvider` in `io.provider.d.ts` correctly exposes `createReadStream?`).
6. Existing `readBinary()` behaviour unchanged in both providers.

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/api/types/io.provider.d.ts` | Add `createReadStream?(range?): NodeJS.ReadableStream` to `IProvider` |
| `src/renderer/content/providers/FileProvider.ts` | Add `createReadStream()` using `nodefs.createReadStream()` |
| `src/renderer/content/providers/HttpProvider.ts` | Add `createReadStream()` using `nodeFetch` + `PassThrough` |

## Files That Need NO Changes

- `src/renderer/content/ContentPipe.ts` — pipe-level streaming is out of scope; no transformer chaining needed
- `src/renderer/content/providers/CacheFileProvider.ts` — cache provider doesn't serve video content
- `src/renderer/content/registry.ts` — no factory changes needed
- `src/renderer/api/node-fetch.ts` — used as-is; no changes
- `src/renderer/editors/video/VPlayer.tsx` — video player integration is US-416
- `src/renderer/editors/video/VideoPlayerEditor.tsx` — no changes
- `src/renderer/editors/video/NodeFetchHlsLoader.ts` — HLS loader is unchanged
- `src/renderer/editors/video/video-types.ts` — no changes
