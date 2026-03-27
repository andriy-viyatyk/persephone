import { app } from "../api/app";
import { OpenLinkEvent } from "../api/events/events";
import { isArchivePath } from "../core/utils/file-path";
import { parseHttpRequest } from "../core/utils/curl-parser";

/**
 * Normalize a file:// URL to a plain file path.
 * Strips "file://" or "file:///" prefix and decodes URI-encoded characters.
 */
function normalizeFileUrl(raw: string): string {
    let path = raw;
    if (path.startsWith("file:///")) {
        path = path.slice(8); // "file:///C:/..." → "C:/..."
    } else if (path.startsWith("file://")) {
        path = path.slice(7); // "file://C:/..." → "C:/..."
    }
    return decodeURIComponent(path);
}

function isFileUrl(raw: string): boolean {
    return raw.startsWith("file://");
}

/**
 * Register Layer 1 parsers on openRawLink.
 *
 * Registration order matters (LIFO execution):
 * 1. fileParser registered first → runs last (fallback)
 * 2. archiveParser registered second → runs first (checks for "!")
 *
 * Call during app bootstrap, before scripts load.
 */
export function registerRawLinkParsers(): void {
    // File parser — fallback for plain file paths and file:// URLs
    app.events.openRawLink.subscribe(async (event) => {
        let filePath = event.raw;
        if (isFileUrl(filePath)) {
            filePath = normalizeFileUrl(filePath);
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(filePath));
        event.handled = true;
    });

    // Archive parser — detects "!" separator
    app.events.openRawLink.subscribe(async (event) => {
        if (!isArchivePath(event.raw)) return;
        let archivePath = event.raw;
        if (isFileUrl(archivePath)) {
            archivePath = normalizeFileUrl(archivePath);
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(archivePath));
        event.handled = true;
    });

    // HTTP parser — detects http:// and https:// URLs
    app.events.openRawLink.subscribe(async (event) => {
        if (!event.raw.startsWith("http://") && !event.raw.startsWith("https://")) return;
        await app.events.openLink.sendAsync(new OpenLinkEvent(event.raw));
        event.handled = true;
    });

    // cURL / fetch parser — detects "curl " or "fetch(" commands
    app.events.openRawLink.subscribe(async (event) => {
        const trimmed = event.raw.trim();
        if (!/^(curl\s|fetch\()/i.test(trimmed)) return;

        const parsed = parseHttpRequest(trimmed);
        if (!parsed) return;

        const metadata: Record<string, unknown> = {};
        if (parsed.method !== "GET") metadata.method = parsed.method;
        if (Object.keys(parsed.headers).length > 0) metadata.headers = parsed.headers;
        if (parsed.body) metadata.body = parsed.body;

        await app.events.openLink.sendAsync(new OpenLinkEvent(parsed.url, undefined, metadata));
        event.handled = true;
    });
}
