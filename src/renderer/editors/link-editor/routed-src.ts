/**
 * Routed `src` resolution for renderer-drawn remote resources (US-896, US-1557).
 *
 * A Tor page's or proxied profile's route lives on its Electron session
 * partition and therefore covers only the page's `<webview>`. The Link editor
 * rendered on that page's blank tab (and its bookmarks drawer, tooltips and
 * Edit-Link dialog), and the browser's tab-strip favicons, are app-rendered
 * `<img src="https://…">`, so the URL would go out over the app session —
 * direct. `resolveRoutedSrc` rewrites such URLs to a scheme the main process
 * fetches through the page's session instead: `tor-src://` for Tor,
 * `profile-src://` for a proxied profile.
 *
 * Lives here rather than under `editors/browser/` to keep the dependency arrow
 * one-way: `browser` already imports `link-editor`, not the reverse.
 */
import { PROFILE_SRC_SCHEME } from "../../../ipc/browser-network-ipc";

/** How renderer content reaches remote resources for the page that owns it. */
export interface ImageRoute {
    /** Wrap a remote URL in the routed scheme. */
    readonly toUrl: (src: string) => string;
    /**
     * False while the route cannot carry traffic yet (a Tor page still
     * bootstrapping or awaiting Reconnect): remote sources are suppressed.
     */
    readonly ready: boolean;
    /**
     * True for a Tor page: nothing fetched for it may reach the on-disk favicon
     * cache. A proxied profile is persistent anyway, so it caches normally.
     */
    readonly private: boolean;
}

/**
 * Target rides a query param, not a path segment: Chromium canonicalizes
 * standard-scheme paths (it may rewrite percent-escapes), which would corrupt a
 * URL containing its own escapes. `URLSearchParams` round-trips exactly.
 */
const routedUrl = (scheme: string, host: string, src: string) =>
    `${scheme}://${host}/?u=${encodeURIComponent(src)}`;

/** Route through a Tor page's session; `ready` only while its circuit is connected. */
export function torImageRoute(partition: string, ready: boolean): ImageRoute {
    return { toUrl: (src) => routedUrl("tor-src", partition, src), ready, private: true };
}

/**
 * Route through a proxied profile's session, by the token main issued for it.
 * `isPrivate` for a proxied Incognito page, which must leave no disk trace either.
 */
export function profileImageRoute(token: string, isPrivate = false): ImageRoute {
    return { toUrl: (src) => routedUrl(PROFILE_SRC_SCHEME, token, src), ready: true, private: isPrivate };
}

/**
 * Schemes that never touch the network, so they render as-is even on a routed
 * page. Anything NOT matching this is treated as remote and requires the route —
 * fail-closed, so an unexpected form (e.g. a protocol-relative `//host/x`) is
 * suppressed rather than silently fetched direct.
 */
const LOCAL_SRC_RE = /^(?:data:|blob:|file:\/\/|app-asset:\/\/)/i;

/**
 * Rewrite a resource URL so it is fetched through the page's route.
 *
 * Returns `null` when the resource must not be loaded at all — the caller should
 * render its placeholder instead of an `<img>`.
 *
 * With no `route` (a standalone `.links.json` editor, or a direct/incognito
 * browser page) the URL is returned unchanged.
 */
export function resolveRoutedSrc(
    src: string | undefined,
    route: ImageRoute | null | undefined,
): string | null {
    if (!src) return null;
    if (!route) return src;
    // Local sources carry no network request — safe to render even while
    // disconnected, and pointless to route.
    if (LOCAL_SRC_RE.test(src)) return src;
    // Route not up yet — suppress rather than leak. Status is read at render
    // time and is deliberately not reactive: reopening the blank tab picks it up.
    if (!route.ready) return null;
    return route.toUrl(src);
}
