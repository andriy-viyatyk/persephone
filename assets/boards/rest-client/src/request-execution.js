import { MAX_REQUEST_BODY_BYTES } from "./http-constants.js";
import { isBinaryContentType } from "./response-utils.js";

const encoder = new TextEncoder();

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return btoa(binary);
}

function filenameFromPath(path) { return path.split(/[\\/]/).at(-1) || "upload.bin"; }

function appendChunk(chunks, chunk, size) {
    const nextSize = size + chunk.byteLength;
    if (nextSize > MAX_REQUEST_BODY_BYTES) throw new Error("Request body exceeds the 32 MiB limit.");
    chunks.push(chunk);
    return nextSize;
}

async function buildBody(request, headers) {
    if (request.bodyType === "raw") return request.body || undefined;
    if (request.bodyType === "form-urlencoded") {
        const pairs = request.formData.filter(row => row.enabled && row.key.trim())
            .map(row => `${encodeURIComponent(row.key.trim())}=${encodeURIComponent(row.value)}`);
        return pairs.length ? pairs.join("&") : undefined;
    }
    if (request.bodyType === "binary") {
        if (!request.binaryFilePath) return undefined;
        const bytes = await persephone.readFile(request.binaryFilePath, { encoding: "binary" });
        if (!(bytes instanceof Uint8Array)) throw new Error("The file bridge did not return binary data.");
        if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error("Request body exceeds the 32 MiB limit.");
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    if (request.bodyType !== "form-data") return undefined;

    const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
    const chunks = [];
    let size = 0;
    for (const entry of request.formDataEntries.filter(row => row.enabled && row.key.trim())) {
        const key = entry.key.trim();
        size = appendChunk(chunks, encoder.encode(`--${boundary}\r\n`), size);
        if (entry.type === "file" && entry.value) {
            const bytes = await persephone.readFile(entry.value, { encoding: "binary" });
            if (!(bytes instanceof Uint8Array)) throw new Error("The file bridge did not return binary data.");
            // Check each file immediately after readFile; the bridge has no size-query operation.
            if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error("Request body exceeds the 32 MiB limit.");
            size = appendChunk(chunks, encoder.encode(`Content-Disposition: form-data; name="${key}"; filename="${filenameFromPath(entry.value)}"\r\nContent-Type: application/octet-stream\r\n\r\n`), size);
            size = appendChunk(chunks, bytes, size);
            size = appendChunk(chunks, encoder.encode("\r\n"), size);
        } else {
            size = appendChunk(chunks, encoder.encode(`Content-Disposition: form-data; name="${key}"\r\n\r\n${entry.value}\r\n`), size);
        }
    }
    size = appendChunk(chunks, encoder.encode(`--${boundary}--\r\n`), size);
    headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
    return new Blob(chunks).arrayBuffer();
}

export async function executeRequest(request, signal) {
    const started = Date.now();
    try {
        const headers = {};
        for (const header of request.headers) if (header.enabled && header.key.trim()) headers[header.key.trim()] = header.value;
        const body = await buildBody(request, headers);
        const response = await persephone.fetch(request.url, {
            method: request.method, headers, ...(body === undefined ? {} : { body }), timeout: 30000,
            maxRedirects: 10, rejectUnauthorized: true, signal,
        });
        const responseHeaders = [];
        response.headers.forEach((value, key) => responseHeaders.push({ key, value, enabled: true }));
        const contentType = response.headers.get("content-type") || "";
        const isBinary = isBinaryContentType(contentType);
        const bodyText = isBinary ? bufferToBase64(await response.arrayBuffer()) : await response.text();
        return {
            response: { status: response.status, statusText: response.statusText, headers: responseHeaders, body: bodyText, isBinary, contentType },
            responseTime: Date.now() - started,
        };
    } catch (error) {
        return {
            response: { status: 0, statusText: "Error", headers: [], body: error?.message || "Request failed." },
            responseTime: Date.now() - started,
        };
    }
}

export function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}
