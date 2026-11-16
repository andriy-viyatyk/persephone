import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { HTTP_FIXTURE_PORT, HTTP_FIXTURE_ROOT } from "./config.mjs";

const MAX_ECHO_BYTES = 1024 * 1024;
const BODYLESS_STATUSES = new Set([204, 205, 304]);

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

export async function startHttpFixtures({ root = HTTP_FIXTURE_ROOT, port = HTTP_FIXTURE_PORT, closeTimeout = 5000 } = {}) {
    const fixtureRoot = await realpath(root);
    const timers = new Set();
    const sockets = new Set();
    const server = http.createServer(async (request, response) => {
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
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Content-Length", (await stat(resolved)).size);
        if (request.method === "HEAD") return response.end();
        createReadStream(resolved).on("error", () => { if (!response.headersSent) send(response, 404, "text/plain; charset=utf-8", "Not Found\n"); else response.destroy(); }).pipe(response);
    });
    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    }).catch((error) => {
        if (server.listening) server.close();
        throw new Error(`Could not start HTTP fixtures on 127.0.0.1:${port}: ${error.message}`);
    });
    let closed = false;
    return {
        async close() {
            if (closed) return;
            closed = true;
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            const closePromise = new Promise((resolve) => server.close(resolve));
            const timeout = setTimeout(() => {
                for (const socket of sockets) socket.destroy();
            }, closeTimeout);
            timeout.unref?.();
            await closePromise;
            clearTimeout(timeout);
        },
    };
}
