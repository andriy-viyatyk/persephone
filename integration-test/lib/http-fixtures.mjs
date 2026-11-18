import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import JSZip from "jszip";
import { FIXTURE_ROOT, HTTP_FIXTURE_PORT, HTTP_FIXTURE_ROOT, HTTPS_FIXTURE_PORT, TLS_FIXTURE_CERT_PATH, TLS_FIXTURE_KEY_PATH } from "./config.mjs";

const MAX_ECHO_BYTES = 1024 * 1024;
const BODYLESS_STATUSES = new Set([204, 205, 304]);
const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
};
// /download limits: body size, chunk count and per-chunk delay.
const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
const MAX_DOWNLOAD_CHUNKS = 200;
const MAX_DOWNLOAD_CHUNK_DELAY_MS = 2000;
const DOWNLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DOWNLOAD_TEXT = "Persephone download fixture.\n";
const BOARDS_CATALOG_ROOT = path.join(FIXTURE_ROOT, "boards-catalog");

function contentTypeFor(filePath) {
    return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "text/plain; charset=utf-8";
}

function intParam(url, name, fallback, max) {
    const value = url.searchParams.get(name);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || Number(value) > max) return undefined;
    return Number(value);
}

function send(response, status, contentType, body, head = false) {
    response.statusCode = status;
    if (contentType) response.setHeader("Content-Type", contentType);
    if (!BODYLESS_STATUSES.has(status)) response.end(head ? undefined : body);
    else response.end();
}

function localPath(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\r\n\\]/.test(value)) return false;
    try {
        const decoded = decodeURIComponent(value);
        return decoded.startsWith("/") && !decoded.startsWith("//") && !/[\r\n\\]/.test(decoded);
    } catch { return false; }
}

async function buildBoardsCatalog() {
    const archives = new Map();
    const sources = new Map();
    async function collectFiles(directory, relative = "") {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const childRelative = path.join(relative, entry.name);
            const child = path.join(directory, entry.name);
            if (entry.isDirectory()) await collectFiles(child, childRelative);
            else if (entry.isFile()) sources.set(childRelative.replaceAll(path.sep, "/"), await readFile(child));
        }
    }

    const boardEntries = [];
    const versionsById = new Map();
    for (const idEntry of await readdir(BOARDS_CATALOG_ROOT, { withFileTypes: true })) {
        if (!idEntry.isDirectory()) continue;
        const id = idEntry.name;
        const boardRoot = path.join(BOARDS_CATALOG_ROOT, id);
        const versionEntries = (await readdir(boardRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
        const versionRecords = [];
        for (const versionEntry of versionEntries) {
            const version = versionEntry.name;
            const versionRoot = path.join(boardRoot, version);
            sources.clear();
            await collectFiles(versionRoot);
            const zip = new JSZip();
            for (const [filename, contents] of sources) zip.file(filename, contents);
            const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
            const manifest = JSON.parse(sources.get("board-manifest.json").toString("utf8"));
            const sha256 = createHash("sha256").update(archive).digest("hex");
            const archivePath = `/boards-catalog/archives/${id}/${version}.zip`;
            const archiveInfo = {
                url: `http://127.0.0.1:${HTTP_FIXTURE_PORT}${archivePath}`,
                size: archive.length,
                sha256: id === "us2095-bad-sha" ? "0".repeat(64) : sha256,
            };
            archives.set(archivePath, archive);
            versionRecords.push({
                version,
                date: version === "99.0.0" ? "2026-01-03T00:00:00.000Z" : version === "1.1.0" ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
                notes: `US-2095 fixture version ${version}`,
                ...(manifest.minAppVersion ? { minAppVersion: manifest.minAppVersion } : {}),
                archive: archiveInfo,
            });
        }
        versionsById.set(id, { schemaVersion: 1, id, versions: versionRecords });
        const latest = versionRecords.find((entry) => entry.version === "1.1.0") ?? versionRecords[0];
        boardEntries.push({
            id,
            name: id === "us2095-versioned" ? "US-2095 Versioned Board" : "US-2095 Bad SHA Board",
            version: latest.version,
            ...(id === "us2095-versioned" ? { screenshot: "catalog.svg" } : {}),
            archive: latest.archive,
        });
    }
    const catalog = Buffer.from(JSON.stringify({ schemaVersion: 1, boards: boardEntries }));
    const versions = new Map([...versionsById].map(([id, value]) => [
        `/boards-catalog/boards/${id}/versions-manifest.json`,
        Buffer.from(JSON.stringify(value)),
    ]));
    const screenshotPath = "/boards-catalog/boards/us2095-versioned/catalog.svg";
    const screenshot = await readFile(path.join(BOARDS_CATALOG_ROOT, "us2095-versioned", "catalog.svg"));
    return { archives, catalog, versions, screenshotPath, screenshot };
}

/**
 * Electron's `sha256/<base64>` fingerprint of the committed, test-only HTTPS fixture certificate
 * (`lib/tls/`, issued for 127.0.0.1 and localhost). The wrapper passes it to test instances through
 * `PERSEPHONE_TEST_TRUSTED_CERTIFICATES`, so only that certificate is accepted.
 */
export function fixtureCertificateFingerprint() {
    const pem = readFileSync(TLS_FIXTURE_CERT_PATH, "utf8");
    const base64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
    return `sha256/${createHash("sha256").update(Buffer.from(base64, "base64")).digest("base64")}`;
}

/** Serve the fixture tree on HTTP (`port`) and HTTPS (`httpsPort`, test certificate) on 127.0.0.1. */
export async function startHttpFixtures({ root = HTTP_FIXTURE_ROOT, port = HTTP_FIXTURE_PORT, httpsPort = HTTPS_FIXTURE_PORT, closeTimeout = 5000 } = {}) {
    const fixtureRoot = await realpath(root);
    const boardsCatalog = await buildBoardsCatalog();
    const timers = new Set();
    const sockets = new Set();
    const refusedPortReservation = net.createServer();
    await new Promise((resolve, reject) => {
        refusedPortReservation.once("error", reject);
        refusedPortReservation.listen(0, "127.0.0.1", resolve);
    });
    const refusedPort = refusedPortReservation.address().port;
    await new Promise((resolve, reject) => refusedPortReservation.close((error) => error ? reject(error) : resolve()));
    const handle = async (request, response) => {
        const rawPath = String(request.url ?? "").split(/[?#]/, 1)[0];
        if (/%2f|%5c/i.test(rawPath)) return send(response, 400, "text/plain; charset=utf-8", "Encoded path separators are not allowed\n", request.method === "HEAD");
        let decodedRawPath;
        try { decodedRawPath = decodeURIComponent(rawPath); }
        catch { return send(response, 400, "text/plain; charset=utf-8", "Malformed path encoding\n", request.method === "HEAD"); }
        if (decodedRawPath.includes("\\") || decodedRawPath.split("/").some((part) => part === "." || part === "..")) {
            return send(response, 400, "text/plain; charset=utf-8", "Invalid fixture path\n", request.method === "HEAD");
        }
        let pathname;
        let url;
        try {
            url = new URL(request.url, `http://127.0.0.1:${port}`);
            pathname = url.pathname;
        } catch {
            send(response, 400, "text/plain; charset=utf-8", "Bad Request\n", request.method === "HEAD");
            return;
        }
        if (pathname === "/echo") {
            const chunks = [];
            let size = 0;
            let tooLarge = false;
            for await (const chunk of request) {
                size += chunk.length;
                if (size > MAX_ECHO_BYTES) tooLarge = true;
                else if (!tooLarge) chunks.push(chunk);
            }
            if (tooLarge) return send(response, 413, "text/plain; charset=utf-8", "Payload Too Large\n");
            const body = Buffer.concat(chunks).toString("utf8");
            return send(response, 200, "application/json; charset=utf-8", JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body }), request.method === "HEAD");
        }
        if (pathname === "/refused") {
            response.statusCode = 302;
            response.setHeader("Location", `http://127.0.0.1:${refusedPort}/`);
            return response.end();
        }
        if (pathname.startsWith("/boards-catalog/")) {
            if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "text/plain; charset=utf-8", "Method Not Allowed\n");
            const archive = boardsCatalog.archives.get(pathname);
            const version = boardsCatalog.versions.get(pathname);
            const body = pathname === "/boards-catalog/boards-manifest.json"
                ? boardsCatalog.catalog
                : version ?? (pathname === boardsCatalog.screenshotPath ? boardsCatalog.screenshot : archive);
            if (!body) return send(response, 404, "text/plain; charset=utf-8", "Not Found\n", request.method === "HEAD");
            const contentType = archive ? "application/zip" : pathname.endsWith(".svg") ? "image/svg+xml" : "application/json; charset=utf-8";
            response.statusCode = 200;
            response.setHeader("Content-Type", contentType);
            response.setHeader("Content-Length", body.length);
            return response.end(request.method === "HEAD" ? undefined : body);
        }
        if (pathname === "/delay") {
            if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "text/plain; charset=utf-8", "Method Not Allowed\n");
            const value = url.searchParams.get("ms");
            if (value === null || !/^\d+$/.test(value) || Number(value) > 5000) return send(response, 400, "text/plain; charset=utf-8", "Invalid ms; expected an integer from 0 to 5000\n", request.method === "HEAD");
            const timer = setTimeout(() => {
                timers.delete(timer);
                if (!response.destroyed) send(response, 200, "text/plain; charset=utf-8", "delayed", request.method === "HEAD");
            }, Number(value));
            timers.add(timer);
            return;
        }
        if (pathname === "/download") {
            // Attachment download: ?name=<file>[&bytes=N][&chunks=N&ms=N] streams a text body in
            // chunks with a delay between them, so a test can watch or cancel a running download.
            if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "text/plain; charset=utf-8", "Method Not Allowed\n");
            const name = url.searchParams.get("name");
            const bytes = intParam(url, "bytes", DOWNLOAD_TEXT.length, MAX_DOWNLOAD_BYTES);
            const chunks = intParam(url, "chunks", 1, MAX_DOWNLOAD_CHUNKS);
            const delay = intParam(url, "ms", 0, MAX_DOWNLOAD_CHUNK_DELAY_MS);
            if (!name || !DOWNLOAD_NAME.test(name) || bytes === undefined || chunks === undefined || chunks < 1 || delay === undefined) {
                return send(response, 400, "text/plain; charset=utf-8", "Invalid download; expected name=<file>, bytes<=4194304, chunks 1-200, ms<=2000\n", request.method === "HEAD");
            }
            const body = Buffer.from(DOWNLOAD_TEXT.repeat(Math.ceil(bytes / DOWNLOAD_TEXT.length) || 1).slice(0, bytes), "utf8");
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/octet-stream");
            response.setHeader("Content-Disposition", `attachment; filename="${name}"`);
            response.setHeader("Content-Length", body.length);
            if (request.method === "HEAD") return response.end();
            const chunkSize = Math.ceil(body.length / chunks) || 1;
            let offset = 0;
            const writeNext = () => {
                if (response.destroyed) return;
                const next = body.subarray(offset, offset + chunkSize);
                offset += next.length;
                if (offset >= body.length) return response.end(next);
                response.write(next);
                const timer = setTimeout(() => { timers.delete(timer); writeNext(); }, delay);
                timers.add(timer);
            };
            writeNext();
            return;
        }
        if (pathname === "/status") {
            if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "text/plain; charset=utf-8", "Method Not Allowed\n");
            const value = url.searchParams.get("code");
            if (value === null || !/^\d{3}$/.test(value) || Number(value) < 200 || Number(value) > 599) return send(response, 400, "text/plain; charset=utf-8", "Invalid code; expected an integer from 200 to 599\n", request.method === "HEAD");
            const status = Number(value);
            return send(response, status, "text/plain; charset=utf-8", `${status}\n`, request.method === "HEAD");
        }
        if (pathname === "/redirect") {
            if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "text/plain; charset=utf-8", "Method Not Allowed\n");
            const destination = url.searchParams.get("to");
            const status = Number(url.searchParams.get("status") ?? "302");
            if (!localPath(destination) || ![301, 302, 303, 307, 308].includes(status)) return send(response, 400, "text/plain; charset=utf-8", "Invalid redirect target or status\n", request.method === "HEAD");
            response.statusCode = status;
            response.setHeader("Location", destination);
            return response.end();
        }

        if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "text/plain; charset=utf-8", "Method Not Allowed\n");
        let decoded;
        try { decoded = decodeURIComponent(url.pathname); }
        catch { return send(response, 400, "text/plain; charset=utf-8", "Malformed path encoding\n", request.method === "HEAD"); }
        if (decoded.includes("\\") || decoded.split("/").some((part) => part === "." || part === "..")) return send(response, 400, "text/plain; charset=utf-8", "Invalid fixture path\n", request.method === "HEAD");
        const candidate = path.resolve(fixtureRoot, `.${decoded}`);
        let resolved;
        try { resolved = await realpath(candidate); }
        catch (error) {
            return send(response, error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 400, "text/plain; charset=utf-8", "Not Found\n", request.method === "HEAD");
        }
        const relativePath = path.relative(fixtureRoot, resolved);
        if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return send(response, 400, "text/plain; charset=utf-8", "Invalid fixture path\n", request.method === "HEAD");
        try {
            if (!(await stat(resolved)).isFile()) return send(response, 404, "text/plain; charset=utf-8", "Not Found\n", request.method === "HEAD");
        } catch { return send(response, 404, "text/plain; charset=utf-8", "Not Found\n", request.method === "HEAD"); }
        response.statusCode = 200;
        response.setHeader("Content-Type", contentTypeFor(resolved));
        response.setHeader("Content-Length", (await stat(resolved)).size);
        if (request.method === "HEAD") return response.end();
        createReadStream(resolved).on("error", () => { if (!response.headersSent) send(response, 404, "text/plain; charset=utf-8", "Not Found\n"); else response.destroy(); }).pipe(response);
    };
    const servers = [
        { server: http.createServer(handle), port, label: "HTTP" },
        { server: https.createServer({ key: readFileSync(TLS_FIXTURE_KEY_PATH), cert: readFileSync(TLS_FIXTURE_CERT_PATH) }, handle), port: httpsPort, label: "HTTPS" },
    ];
    for (const { server } of servers) {
        server.on("connection", (socket) => {
            sockets.add(socket);
            socket.once("close", () => sockets.delete(socket));
        });
    }
    for (const { server, port: listenPort, label } of servers) {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(listenPort, "127.0.0.1", resolve);
        }).catch((error) => {
            for (const entry of servers) if (entry.server.listening) entry.server.close();
            throw new Error(`Could not start ${label} fixtures on 127.0.0.1:${listenPort}: ${error.message}`);
        });
    }
    let closed = false;
    return {
        async close() {
            if (closed) return;
            closed = true;
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            const closePromise = Promise.all(servers.map(({ server }) => new Promise((resolve) => server.close(resolve))));
            const timeout = setTimeout(() => {
                for (const socket of sockets) socket.destroy();
            }, closeTimeout);
            timeout.unref?.();
            await closePromise;
            clearTimeout(timeout);
        },
    };
}
