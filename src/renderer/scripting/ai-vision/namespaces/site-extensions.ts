import type { IAiMember, IAiVisionDescriptor } from "ai-vision";

const SITE_EXTENSION_MEMBERS: readonly IAiMember[] = [
    { name: "folder", kind: "property", summary: "The effective site-extension root folder (read-only)." },
    { name: "list", kind: "method", signature: "list()", summary: "List validation, host conflicts, and derived trust state without exposing trust-file data." },
    { name: "create", kind: "method", signature: "create(id: string, options: { name: string; hosts: string[]; description?: string })", summary: "Scaffold an extension and starter script; the user must approve it in the matching browser page's Trust bar.", caution: "writes executable code to disk but does not trust or run it" },
    { name: "reload", kind: "method", signature: "reload(pageId: string)", summary: "Reload the trusted extension in the browser page's current document and preserve page state.", caution: "runs the trusted site script with the signed-in page's capabilities" },
    { name: "remove", kind: "method", signature: "remove(id: string)", summary: "Ask before removing extension files and revoking any existing trust grant.", caution: "deletes files and revokes trust after user confirmation" },
];

const SITE_EXTENSIONS_HELP = `
siteExtensions manages extensions injected into exact HTTPS hostnames. create(id, options) writes
manifest.json and extension.js, but no member can grant or request trust. Only the user can approve
execution in the matching browser page's Trust bar. Edit the generated script with app.fs.write(...).
An extension runs with the signed-in page's capabilities, so review it before trusting it.

reload(pageId) targets the browser editor's active internal tab and keeps the current page document.
Its status is one of injected, waiting-for-user, disabled, no-extension, extension-error, or
not-current. injected includes registered=false when the model does not register before the bounded
probe deadline. waiting-for-user leaves the normal Trust bar available. disabled means the user
disabled a current grant. no-extension means no valid, unconflicted extension matches the page host.
not-current means the page is unavailable, private, non-HTTPS, not ready, or changed during reload.
Page script exceptions return a bounded, sanitized, page-derived message; host-side file or evaluation
failures return a bounded explanatory message.

The starter registers cleanup with __persephoneSiteRuntime.onDispose(). Add a cleanup for each
listener, observer, or timer so in-place reload can dispose it. Page navigation remains the hard reset.
remove(id) uses the same confirmation as the Site Extensions hub and revokes trust only after Delete.
`.trim();

export function describeSiteExtensions(_instance: unknown): IAiVisionDescriptor {
    return {
        kind: "SiteExtensions",
        summary: "Inspect, scaffold, reload, and remove trusted HTTPS site extensions.",
        members: SITE_EXTENSION_MEMBERS,
        help: SITE_EXTENSIONS_HELP,
    };
}
