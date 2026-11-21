/**
 * Scheme policy for URLs that come from web pages: navigation, shared by the main process (guest
 * navigation and window-open guards) and the renderer (URLs it opens on a web page's behalf), and
 * the images a page hands the host to draw.
 */
const BLOCKED_PROTOCOLS = ["file:", "app-asset:"];
const CHROMIUM_NAVIGATION_PROTOCOLS = ["http:", "https:", "about:", "blob:", "mailto:", "tel:"];

export const USER_ACTIVATION_WINDOW_MS = 5000;

export type NavigationScheme = "blocked" | "chromium" | "external" | "invalid";

export function getNavigationScheme(url: string): NavigationScheme {
    try {
        const protocol = new URL(url).protocol;
        if (BLOCKED_PROTOCOLS.includes(protocol)) return "blocked";
        if (CHROMIUM_NAVIGATION_PROTOCOLS.includes(protocol)) return "chromium";
        return "external";
    } catch {
        return "invalid";
    }
}

/**
 * What may happen to a URL that came from a web page and would become a new top-level document
 * (a link opened in a new tab, `target=_blank`, `window.open`). The same rule as page-initiated
 * navigation: Chromium schemes open, other schemes are handed to the host (where only a trusted
 * board's claimed scheme is consumed, so `data:` and `javascript:` go nowhere), and local schemes
 * and unparsable URLs are refused.
 */
export type PageOpenAction = "open" | "handoff" | "refuse";

export function getPageOpenAction(url: string): PageOpenAction {
    const scheme = getNavigationScheme(url);
    if (scheme === "chromium") return "open";
    if (scheme === "external") return "handoff";
    return "refuse";
}

/**
 * Whether an image URL that came from a web page (its favicon, a clicked thumbnail, an image in
 * Markdown fetched from the web) may be drawn or downloaded by the host: `http(s)` URLs, which the
 * host routes through the page's session, and inline `data:image/` URLs. Everything else is refused —
 * above all `file:` and UNC paths, which the host window would load itself (a `file://host/…` URL
 * opens an SMB connection from the real address, outside any Tor or proxy route).
 */
export function isWebImageUrl(url: string): boolean {
    if (/^data:image\//i.test(url)) return true;
    try {
        const protocol = new URL(url).protocol;
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}
