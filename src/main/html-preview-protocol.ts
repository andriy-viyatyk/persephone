import { session, type WebContents } from "electron";

/** Each preview's current HTML, keyed by its random id (the URL host). */
const previews = new Map<string, { html: string; owner: WebContents }>();
const ownersWithCleanup = new WeakSet<WebContents>();

/** The policy a preview inherited from the main window before US-1590; kept verbatim so user HTML
 *  (inline scripts, CDN scripts) behaves exactly as before. */
const PREVIEW_CSP = "script-src 'self' 'unsafe-inline' 'unsafe-eval' file: data: blob: https: http:; worker-src 'self' blob:; child-src 'self' blob:;";

export function setHtmlPreview(owner: WebContents, id: string, html: string): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) {
        throw new Error("Invalid HTML preview id.");
    }

    previews.set(id, { html, owner });
    if (ownersWithCleanup.has(owner)) return;

    ownersWithCleanup.add(owner);
    const dropOwnerPreviews = () => {
        for (const [previewId, preview] of previews) {
            if (preview.owner === owner) previews.delete(previewId);
        }
    };
    owner.once("destroyed", dropOwnerPreviews);
    // A renderer reload keeps the same WebContents but disposes no view, so its previews would
    // otherwise stay until the window closes. The new document registers its own previews after
    // the navigation commits.
    owner.on("did-navigate", dropOwnerPreviews);
}

export function clearHtmlPreview(id: string): void {
    previews.delete(id);
}

export function initHtmlPreviewProtocol(partition: string): void {
    session.fromPartition(partition).protocol.handle("html-preview", (request) => {
        const id = new URL(request.url).hostname;
        const preview = previews.get(id);
        if (!preview) return new Response("", { status: 404 });

        return new Response(preview.html, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Security-Policy": PREVIEW_CSP,
                "Cache-Control": "no-store",
            },
        });
    });
}
