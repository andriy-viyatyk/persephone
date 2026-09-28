import { app } from "../api/app";
import { isArchivePath } from "../core/utils/file-path";
import { parseHttpRequest } from "../core/utils/curl-parser";
import { canonicalizeScheme, dispatchRegisteredSchemeParse } from "./scheme-registry";
import "./builtin-schemes";
import { normalizeFileUrl, isFileUrl, isPlausibleFilePath, splitUrlFragment } from "./link-utils";

/** Register Layer 1 fallbacks and the registry-backed scheme dispatcher. */
export function registerRawLinkParsers(): void {
    // File parser — fallback for plain file paths and file:// URLs.
    app.events.openRawLink.subscribe(async (data) => {
        let filePath = data.href;
        if (isFileUrl(filePath)) {
            const split = splitUrlFragment(filePath);
            filePath = normalizeFileUrl(split.url);
            if (split.fragment) data.fragment ??= split.fragment;
        }
        if (!isPlausibleFilePath(filePath)) {
            const { ui } = await import("../api/ui");
            ui.notify(`Invalid file path: ${filePath}`, "warning");
            data.handled = true;
            return;
        }
        data.url = filePath;
        data.handled = false;
        await app.events.openLink.sendAsync(data);
        data.handled = true;
    });

    // Archive parser — registered after the file fallback so LIFO keeps archive ahead of file.
    app.events.openRawLink.subscribe(async (data) => {
        if (!isArchivePath(data.href)) return;
        let archivePath = data.href;
        if (isFileUrl(archivePath)) {
            const split = splitUrlFragment(archivePath);
            archivePath = normalizeFileUrl(split.url);
            if (split.fragment) data.fragment ??= split.fragment;
        }
        data.url = archivePath;
        data.handled = false;
        await app.events.openLink.sendAsync(data);
        data.handled = true;
    });

    // Registered schemes run before the file fallback but after the cURL/fetch auxiliary parser.
    app.events.openRawLink.subscribe(async (data) => {
        data.href = canonicalizeScheme(data.href);
        await dispatchRegisteredSchemeParse(data, () => app.events.openLink.sendAsync(data));
    });

    // cURL / fetch is an auxiliary parser, not a registry scheme. It must run first for commands.
    app.events.openRawLink.subscribe(async (data) => {
        const trimmed = data.href.trim();
        if (!/^(curl\s|fetch\()/i.test(trimmed)) return;

        const parsed = parseHttpRequest(trimmed);
        if (!parsed) return;

        if (parsed.method !== "GET") data.method ??= parsed.method;
        if (Object.keys(parsed.headers).length > 0) data.headers ??= parsed.headers;
        if (parsed.body) data.body ??= parsed.body;

        data.url = parsed.url;
        data.handled = false;
        await app.events.openLink.sendAsync(data);
        data.handled = true;
    });
}
