/**
 * Serialize a RestRequest into various clipboard-friendly formats.
 * Reverse of parseClipboardRequest.
 */

import { RestRequest } from "./restClientTypes";

// =============================================================================
// Helpers
// =============================================================================

function getEnabledHeaders(request: RestRequest): { key: string; value: string }[] {
    return request.headers
        .filter((h) => h.enabled && h.key.trim())
        .map((h) => ({ key: h.key.trim(), value: h.value }));
}

function getBodyString(request: RestRequest): string | undefined {
    if (request.bodyType === "none") return undefined;
    if (request.bodyType === "form-urlencoded") {
        const pairs = request.formData
            .filter((f) => f.enabled && f.key.trim())
            .map((f) => `${encodeURIComponent(f.key.trim())}=${encodeURIComponent(f.value)}`);
        return pairs.length > 0 ? pairs.join("&") : undefined;
    }
    // raw
    return request.body || undefined;
}

// =============================================================================
// cURL (bash)
// =============================================================================

export function serializeAsCurlBash(request: RestRequest): string {
    const parts: string[] = ["curl"];
    const headers = getEnabledHeaders(request);
    const body = getBodyString(request);

    // URL (single-quoted)
    parts.push(`'${request.url.replace(/'/g, "'\\''")}'`);

    // Method (only if not GET, or GET with body)
    if (request.method !== "GET" || body) {
        parts.push(`-X ${request.method}`);
    }

    // Headers
    for (const h of headers) {
        const val = `${h.key}: ${h.value}`.replace(/'/g, "'\\''");
        parts.push(`-H '${val}'`);
    }

    // Body
    if (body) {
        const escaped = body.replace(/'/g, "'\\''");
        parts.push(`--data-raw '${escaped}'`);
    }

    return parts.join(" \\\n  ");
}

// =============================================================================
// cURL (cmd)
// =============================================================================

export function serializeAsCurlCmd(request: RestRequest): string {
    const parts: string[] = ["curl"];
    const headers = getEnabledHeaders(request);
    const body = getBodyString(request);

    // URL (double-quoted, escape inner quotes)
    parts.push(`"${request.url.replace(/"/g, '\\"')}"`);

    // Method
    if (request.method !== "GET" || body) {
        parts.push(`-X ${request.method}`);
    }

    // Headers
    for (const h of headers) {
        const val = `${h.key}: ${h.value}`.replace(/"/g, '\\"');
        parts.push(`-H "${val}"`);
    }

    // Body
    if (body) {
        const escaped = body.replace(/"/g, '\\"');
        parts.push(`--data-raw "${escaped}"`);
    }

    return parts.join(" ^\n  ");
}

// =============================================================================
// fetch (browser)
// =============================================================================

export function serializeAsFetch(request: RestRequest): string {
    const headers = getEnabledHeaders(request);
    const body = getBodyString(request);

    const options: string[] = [];

    if (request.method !== "GET") {
        options.push(`  method: ${JSON.stringify(request.method)}`);
    }

    if (headers.length > 0) {
        const headerEntries = headers
            .map((h) => `    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)}`)
            .join(",\n");
        options.push(`  headers: {\n${headerEntries}\n  }`);
    }

    if (body) {
        options.push(`  body: ${JSON.stringify(body)}`);
    }

    if (options.length === 0) {
        return `fetch(${JSON.stringify(request.url)});`;
    }

    return `fetch(${JSON.stringify(request.url)}, {\n${options.join(",\n")}\n});`;
}

// =============================================================================
// fetch (Node.js)
// =============================================================================

export function serializeAsFetchNodeJs(request: RestRequest): string {
    const headers = getEnabledHeaders(request);
    const body = getBodyString(request);

    const options: string[] = [];

    if (request.method !== "GET") {
        options.push(`  method: ${JSON.stringify(request.method)}`);
    }

    if (headers.length > 0) {
        const headerEntries = headers
            .map((h) => `    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)}`)
            .join(",\n");
        options.push(`  headers: {\n${headerEntries}\n  }`);
    }

    if (body) {
        options.push(`  body: ${JSON.stringify(body)}`);
    }

    if (options.length === 0) {
        return `const res = await fetch(${JSON.stringify(request.url)});`;
    }

    return `const res = await fetch(${JSON.stringify(request.url)}, {\n${options.join(",\n")}\n});`;
}
