import { app } from "../api/app";
import { OpenLinkEvent } from "../api/events/events";
import type { ILinkMetadata } from "../api/types/io.events";
import { isArchivePath } from "../core/utils/file-path";
import { parseHttpRequest } from "../core/utils/curl-parser";
import { TREE_CATEGORY_PREFIX } from "./tree-providers/tree-provider-link";
import { normalizeFileUrl, isFileUrl, isPlausibleFilePath } from "./link-utils";

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
        if (!isPlausibleFilePath(filePath)) {
            const { ui } = await import("../api/ui");
            ui.notify(`Invalid file path: ${filePath}`, "warning");
            event.handled = true;
            return;
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(filePath, event.target, event.metadata));
        event.handled = true;
    });

    // Archive parser — detects "!" separator
    app.events.openRawLink.subscribe(async (event) => {
        if (!isArchivePath(event.raw)) return;
        let archivePath = event.raw;
        if (isFileUrl(archivePath)) {
            archivePath = normalizeFileUrl(archivePath);
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(archivePath, event.target, event.metadata));
        event.handled = true;
    });

    // HTTP parser — detects http:// and https:// URLs
    app.events.openRawLink.subscribe(async (event) => {
        if (!event.raw.startsWith("http://") && !event.raw.startsWith("https://")) return;
        await app.events.openLink.sendAsync(new OpenLinkEvent(event.raw, event.target, event.metadata));
        event.handled = true;
    });

    // data: URL parser — inline content (scripts, styles)
    app.events.openRawLink.subscribe(async (event) => {
        if (!event.raw.startsWith("data:")) return;
        await app.events.openLink.sendAsync(new OpenLinkEvent(event.raw, event.target, event.metadata));
        event.handled = true;
    });

    // tree-category:// parser — detects category links for folder/category navigation
    app.events.openRawLink.subscribe(async (event) => {
        if (!event.raw.startsWith(TREE_CATEGORY_PREFIX)) return;
        await app.events.openLink.sendAsync(
            new OpenLinkEvent(event.raw, event.target ?? "category-view", event.metadata),
        );
        event.handled = true;
    });

    // cURL / fetch parser — detects "curl " or "fetch(" commands
    app.events.openRawLink.subscribe(async (event) => {
        const trimmed = event.raw.trim();
        if (!/^(curl\s|fetch\()/i.test(trimmed)) return;

        const parsed = parseHttpRequest(trimmed);
        if (!parsed) return;

        const metadata: ILinkMetadata = {};
        if (parsed.method !== "GET") metadata.method = parsed.method;
        if (Object.keys(parsed.headers).length > 0) metadata.headers = parsed.headers;
        if (parsed.body) metadata.body = parsed.body;

        // Merge cURL metadata with caller metadata (caller overrides)
        const merged = event.metadata ? { ...metadata, ...event.metadata } : metadata;
        await app.events.openLink.sendAsync(new OpenLinkEvent(parsed.url, event.target, merged));
        event.handled = true;
    });
}
