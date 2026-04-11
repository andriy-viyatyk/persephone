import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VideoStreamSessionConfig, VideoStreamSessionResult } from "../ipc/api-param-types";

const DEFAULT_PORT = 7866;
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// ── Faststart types ────────────────────────────────────────────────

interface Mp4Atom {
    type: string;
    offset: number;
    size: number;
}

/** A segment of the virtual faststart file. */
interface VirtualSegment {
    virtualStart: number;
    size: number;
    source: "file" | "buffer";
    fileOffset: number;    // meaningful when source === "file"
    buffer: Buffer | null; // meaningful when source === "buffer"
}

/** Virtual file layout that presents moov before mdat. */
interface FaststartLayout {
    totalSize: number;
    segments: VirtualSegment[];
    filePath: string;
}

// ── Session types ──────────────────────────────────────────────────

interface SessionData {
    config: VideoStreamSessionConfig;
    lastAccessed: number;
    pageId: string | undefined;
    faststart?: FaststartLayout;
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

    let faststart: FaststartLayout | undefined;
    if (config.filePath && /\.mp4$/i.test(config.filePath)) {
        const layout = await buildFaststartLayout(config.filePath);
        if (layout) faststart = layout;
    }

    sessions.set(sessionId, { config, lastAccessed: Date.now(), pageId: config.pageId, faststart });
    return {
        sessionId,
        streamingUrl: `http://127.0.0.1:${currentPort}/video-stream/${sessionId}`,
    };
}

export function deleteSession(sessionId: string): void {
    sessions.delete(sessionId);
}

export function deleteSessionsByPage(pageId: string): void {
    for (const [id, session] of sessions) {
        if (session.pageId === pageId) {
            sessions.delete(id);
        }
    }
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
    const server = http.createServer(handleRequest);
    httpServer = server;

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
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    });
}

// ── Request handler ─────────────────────────────────────────────────

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers so the renderer <video> element can load from localhost
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
        if (session.faststart) {
            handleFaststartRequest(session.faststart, rangeHeader, res).catch(onError);
        } else {
            handleFileRequest(config.filePath, rangeHeader, res).catch(onError);
        }
    } else if (config.url) {
        handleHttpRequest(config, rangeHeader, res).catch(onError);
    } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid session config: no filePath or url");
    }
}

// ── File source (passthrough, no reorder) ──────────────────────────

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
            res.writeHead(416, { "Content-Range": `bytes */${totalSize}` });
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

// ── Faststart file source (moov relocated before mdat) ─────────────

async function handleFaststartRequest(
    layout: FaststartLayout,
    rangeHeader: string | undefined,
    res: http.ServerResponse,
): Promise<void> {
    const { totalSize, filePath } = layout;
    const contentType = getContentTypeFromPath(filePath);

    if (rangeHeader) {
        const range = parseRangeHeader(rangeHeader, totalSize);
        if (!range) {
            res.writeHead(416, { "Content-Range": `bytes */${totalSize}` });
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

        await streamVirtualRange(layout, start, end, res);
    } else {
        res.writeHead(200, {
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Content-Length": totalSize,
        });

        await streamVirtualRange(layout, 0, totalSize - 1, res);
    }
}

/** Serve a byte range from the virtual faststart layout. */
async function streamVirtualRange(
    layout: FaststartLayout,
    start: number,
    end: number,
    res: http.ServerResponse,
): Promise<void> {
    for (const seg of layout.segments) {
        if (res.destroyed) break;

        const segEnd = seg.virtualStart + seg.size - 1;
        if (segEnd < start) continue;  // segment entirely before range
        if (seg.virtualStart > end) break; // past range

        const overlapStart = Math.max(start, seg.virtualStart);
        const overlapEnd = Math.min(end, segEnd);
        const segOffset = overlapStart - seg.virtualStart;
        const segLength = overlapEnd - overlapStart + 1;

        if (seg.source === "buffer" && seg.buffer) {
            const slice = seg.buffer.subarray(segOffset, segOffset + segLength);
            const ok = res.write(slice);
            if (!ok) await new Promise<void>((r) => res.once("drain", r));
        } else {
            const fileStart = seg.fileOffset + segOffset;
            const fileEnd = fileStart + segLength - 1;
            await pipeFileRange(layout.filePath, fileStart, fileEnd, res);
        }
    }
    if (!res.destroyed) res.end();
}

/** Pipe a byte range from a file to a writable stream (without ending it). */
function pipeFileRange(
    filePath: string,
    start: number,
    end: number,
    dest: http.ServerResponse,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on("error", (err) => {
            if (!dest.writableEnded) dest.destroy(err);
            reject(err);
        });
        stream.on("end", resolve);
        stream.pipe(dest, { end: false });
    });
}

// ── Faststart layout builder ───────────────────────────────────────

/**
 * Analyse an MP4 file and, if the moov atom comes after mdat,
 * build a virtual layout that presents moov first.
 * Returns null if the file is already faststart or not an MP4.
 */
async function buildFaststartLayout(filePath: string): Promise<FaststartLayout | null> {
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const fd = fs.openSync(filePath, "r");

    try {
        const atoms = parseTopLevelAtoms(fd, fileSize);
        const moovAtom = atoms.find((a) => a.type === "moov");
        const firstMdat = atoms.find((a) => a.type === "mdat");

        if (!moovAtom || !firstMdat) return null;
        if (moovAtom.offset < firstMdat.offset) return null; // already faststart

        // Read moov into buffer and adjust chunk offsets
        const moovBuf = Buffer.alloc(moovAtom.size);
        fs.readSync(fd, moovBuf, 0, moovAtom.size, moovAtom.offset);
        adjustChunkOffsets(moovBuf, moovAtom.size);

        // Build virtual segment list: [pre-mdat atoms] [moov] [mdat+ atoms]
        const segments: VirtualSegment[] = [];
        let virtualPos = 0;

        // 1. Atoms before the first mdat (ftyp, free, etc.)
        for (const atom of atoms) {
            if (atom.offset >= firstMdat.offset) break;
            if (atom.type === "moov") continue; // moov before mdat is impossible here, but guard anyway
            segments.push({
                virtualStart: virtualPos,
                size: atom.size,
                source: "file",
                fileOffset: atom.offset,
                buffer: null,
            });
            virtualPos += atom.size;
        }

        // 2. Relocated moov (from buffer with adjusted offsets)
        segments.push({
            virtualStart: virtualPos,
            size: moovAtom.size,
            source: "buffer",
            fileOffset: 0,
            buffer: moovBuf,
        });
        virtualPos += moovAtom.size;

        // 3. mdat atoms and anything else after them (excluding moov)
        for (const atom of atoms) {
            if (atom.offset < firstMdat.offset) continue;
            if (atom.type === "moov") continue;
            segments.push({
                virtualStart: virtualPos,
                size: atom.size,
                source: "file",
                fileOffset: atom.offset,
                buffer: null,
            });
            virtualPos += atom.size;
        }

        return { totalSize: virtualPos, segments, filePath };
    } finally {
        fs.closeSync(fd);
    }
}

// ── MP4 atom parsing ───────────────────────────────────────────────

function parseTopLevelAtoms(fd: number, fileSize: number): Mp4Atom[] {
    const atoms: Mp4Atom[] = [];
    let offset = 0;
    const header = Buffer.alloc(16);

    while (offset < fileSize && atoms.length < 50) {
        const n = fs.readSync(fd, header, 0, 16, offset);
        if (n < 8) break;

        let size = header.readUInt32BE(0);
        const type = header.toString("ascii", 4, 8);

        if (size === 1 && n >= 16) {
            // 64-bit extended size
            const hi = header.readUInt32BE(8);
            const lo = header.readUInt32BE(12);
            size = hi * 4294967296 + lo; // hi * 2^32 + lo
        }
        if (size === 0) size = fileSize - offset; // extends to EOF
        if (size < 8) break;

        atoms.push({ type, offset, size });
        offset += size;
    }
    return atoms;
}

// ── Chunk offset adjustment (stco / co64) ──────────────────────────

/** Container atom types that may hold stco/co64 deeper inside. */
const CONTAINER_ATOMS = new Set([
    "moov", "trak", "mdia", "minf", "stbl", "edts", "udta", "meta", "ilst", "mvex", "sinf", "schi",
]);

/**
 * Walk the moov buffer, find every stco and co64 atom, and add `delta`
 * to each chunk offset.  This compensates for moov being moved before mdat.
 *
 * `buf` is the full moov atom including its 8-byte header.
 * `delta` is `moov.size` (the amount mdat shifted right).
 */
function adjustChunkOffsets(buf: Buffer, delta: number): void {
    // Start parsing after the moov atom header (8 bytes)
    walkAtoms(buf, 8, buf.length, delta);
}

function walkAtoms(buf: Buffer, start: number, end: number, delta: number): void {
    let pos = start;
    while (pos + 8 <= end) {
        const size = buf.readUInt32BE(pos);
        const type = buf.toString("ascii", pos + 4, pos + 8);
        if (size < 8 || pos + size > end) break;

        if (type === "stco") {
            patchStco(buf, pos, delta);
        } else if (type === "co64") {
            patchCo64(buf, pos, delta);
        } else if (CONTAINER_ATOMS.has(type)) {
            walkAtoms(buf, pos + 8, pos + size, delta);
        }

        pos += size;
    }
}

/** Patch 32-bit chunk offsets in an stco atom. */
function patchStco(buf: Buffer, atomPos: number, delta: number): void {
    // Layout: [size:4][type:4][version+flags:4][count:4][offsets:4*N]
    const countPos = atomPos + 12;
    if (countPos + 4 > buf.length) return;
    const count = buf.readUInt32BE(countPos);
    const base = countPos + 4;

    for (let i = 0; i < count; i++) {
        const p = base + i * 4;
        if (p + 4 > buf.length) break;
        buf.writeUInt32BE(buf.readUInt32BE(p) + delta, p);
    }
}

/** Patch 64-bit chunk offsets in a co64 atom. */
function patchCo64(buf: Buffer, atomPos: number, delta: number): void {
    // Layout: [size:4][type:4][version+flags:4][count:4][offsets:8*N]
    const countPos = atomPos + 12;
    if (countPos + 4 > buf.length) return;
    const count = buf.readUInt32BE(countPos);
    const base = countPos + 4;

    for (let i = 0; i < count; i++) {
        const p = base + i * 8;
        if (p + 8 > buf.length) break;
        const hi = buf.readUInt32BE(p);
        const lo = buf.readUInt32BE(p + 4);
        const val = hi * 4294967296 + lo + delta;
        buf.writeUInt32BE(Math.floor(val / 4294967296), p);
        buf.writeUInt32BE(val % 4294967296, p + 4);
    }
}

// ── HTTP source ─────────────────────────────────────────────────────

async function handleHttpRequest(
    config: VideoStreamSessionConfig,
    rangeHeader: string | undefined,
    res: http.ServerResponse,
): Promise<void> {
    const { url, headers: customHeaders = {}, method = "GET" } = config;

    if (!url) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid session config: no url");
        return;
    }

    // Force identity encoding so Range byte offsets match raw content bytes
    const requestHeaders: Record<string, string> = {
        ...customHeaders,
        "Accept-Encoding": "identity",
    };

    if (rangeHeader) {
        requestHeaders["Range"] = rangeHeader;
    }

    const sourceResponse = await makeHttpRequest(url, method, requestHeaders);
    const statusCode = sourceResponse.statusCode ?? 200;

    const forwardHeaders: Record<string, string | number> = {
        "Accept-Ranges": "bytes",
    };

    const contentType = sourceResponse.headers["content-type"];
    if (contentType) {
        forwardHeaders["Content-Type"] = Array.isArray(contentType) ? contentType[0] : contentType;
    }

    const contentLength = sourceResponse.headers["content-length"];
    if (contentLength) {
        forwardHeaders["Content-Length"] = Array.isArray(contentLength) ? contentLength[0] : contentLength;
    }

    const contentRange = sourceResponse.headers["content-range"];
    if (contentRange) {
        forwardHeaders["Content-Range"] = Array.isArray(contentRange) ? contentRange[0] : contentRange;
    }

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
