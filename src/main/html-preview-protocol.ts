import { net, session, type Session, type WebContents } from "electron";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { errMessage } from "../shared/utils";
import { mimeTypeForPath } from "../shared/mime-types";
import { boardFileAccess } from "./board-file-access";
import { onWebContentsGone } from "./webcontents-lifetime";

/** Each preview's current HTML, keyed by its random id (the URL host). */
const previews = new Map<string, { html: string; owner: WebContents; resourceRoot?: string }>();
const ownersWithCleanup = new WeakSet<WebContents>();
let previewSession: Session | undefined;

const PREVIEW_CSP = "default-src 'self' 'unsafe-inline' 'unsafe-eval' http: https: data: blob: ws: wss:; worker-src 'self' blob:;";

function removePreview(id: string): void {
    if (!previews.delete(id)) return;
    if (!previewSession) return;
    void previewSession.clearStorageData({ origin: `html-preview://${id}` }).catch((error: unknown) => {
        console.error(`Failed to clear HTML preview storage: ${errMessage(error)}`);
    });
}

export function setHtmlPreview(owner: WebContents, id: string, html: string, resourceRoot?: string): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) {
        throw new Error("Invalid HTML preview id.");
    }

    previews.set(id, { html, owner, resourceRoot });
    if (ownersWithCleanup.has(owner)) return;

    ownersWithCleanup.add(owner);
    const dropOwnerPreviews = () => {
        for (const [previewId, preview] of previews) {
            if (preview.owner === owner) removePreview(previewId);
        }
    };
    // A renderer reload keeps the same WebContents but disposes no view, so its previews would
    // otherwise stay until the window closes. The new document registers its own previews after
    // the navigation commits.
    onWebContentsGone(owner, dropOwnerPreviews, { events: ["destroyed", "did-navigate"], repeat: true });
}

export function clearHtmlPreview(id: string): void {
    removePreview(id);
}

export function initHtmlPreviewProtocol(partition: string): void {
    previewSession = session.fromPartition(partition);
    previewSession.protocol.handle("html-preview", async (request) => {
        const url = new URL(request.url);
        const id = url.hostname;
        const preview = previews.get(id);
        if (!preview) return new Response("", { status: 404 });

        if (!url.pathname || url.pathname === "/") {
            return new Response(preview.html, {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Content-Security-Policy": PREVIEW_CSP,
                    "Cache-Control": "no-store",
                },
            });
        }
        if (!preview.resourceRoot || /%(?:2f|5c)/i.test(url.pathname)) {
            return new Response("Not found", { status: 404 });
        }

        let relativePath: string;
        try {
            relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        } catch {
            return new Response("Not found", { status: 404 });
        }
        if (!relativePath || relativePath.includes("\\")) return new Response("Not found", { status: 404 });

        let resolvedPath: string;
        try {
            resolvedPath = await boardFileAccess.authorizeInsideRoot(preview.resourceRoot, relativePath);
        } catch {
            return new Response("Not found", { status: 404 });
        }

        try {
            if (!(await fs.promises.stat(resolvedPath)).isFile()) return new Response("Not found", { status: 404 });
        } catch {
            return new Response("Not found", { status: 404 });
        }

        const mimeType = mimeTypeForPath(resolvedPath);
        let response: Response;
        try {
            response = await net.fetch(pathToFileURL(resolvedPath).toString(), {
                bypassCustomProtocolHandlers: true,
            });
        } catch {
            return new Response("Not found", { status: 404 });
        }
        if (!response.ok) return new Response("Not found", { status: 404 });

        const headers = new Headers({
            "Content-Type": mimeType,
            "Cache-Control": "no-store",
        });
        if (mimeType === "text/html") headers.set("Content-Security-Policy", PREVIEW_CSP);
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    });
}
