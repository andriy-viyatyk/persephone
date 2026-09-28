/**
 * IPC contract for per-profile browser network settings (US-1557).
 *
 * A browser profile's Electron session partition (`persist:browser-<name>`), or
 * an Incognito page's in-memory one, can be pointed at a SOCKS5/HTTP proxy.
 * Main owns the proxy state; the renderer owns the settings and pushes a page's
 * network to main before the page mounts.
 */

/** Network route for a browser profile. Secret-free: no proxy credentials. */
export type BrowserNetwork =
    | { kind: "direct" }
    | { kind: "proxy"; protocol: BrowserProxyProtocol; host: string; port: number };

export type BrowserProxyProtocol = "socks5" | "http";

/** Scheme for app-rendered remote resources fetched through a proxied profile session. */
export const PROFILE_SRC_SCHEME = "profile-src";

/**
 * What the outside world sees for a browser session. Every field is best-effort:
 * the geo providers are third parties that may be down or rate-limiting.
 */
export interface EgressIpInfo {
    /** Egress IP as seen by the checker, or "" when the lookup failed. */
    ip: string;
    /** Country (2-letter code, or a full name from the fallback provider). */
    country?: string;
    region?: string;
    city?: string;
    /** ASN / organisation of the egress address, when the provider reports it. */
    org?: string;
    /** Hostname of the geo provider that answered. */
    geoSource?: string;
    /** Human-readable failure reason; set when `ip` is empty. */
    error?: string;
}

/** Result of `browser-network:apply`. */
export interface BrowserNetworkApplyResult {
    /**
     * Opaque capability for `profile-src://<token>/?u=<url>`. Present only while
     * the partition is proxied; invalidated when it goes direct or changes proxy.
     */
    token?: string;
}

/** A syntactically valid proxy endpoint, or an error message for the settings UI. */
export function validateProxyEndpoint(host: string, port: number): string | undefined {
    if (!host) return "Host is required.";
    if (!/^[A-Za-z0-9.\-_]+$|^\[[0-9A-Fa-f:.]+\]$/.test(host)) {
        return "Host must be a name or an IP address, without a scheme, path, or spaces.";
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "Port must be 1-65535.";
    return undefined;
}

/** Chromium `proxyRules` for a proxied network. */
export function proxyRulesFor(network: Extract<BrowserNetwork, { kind: "proxy" }>): string {
    return `${network.protocol}://${network.host}:${network.port}`;
}

/** Short label such as `SOCKS5 127.0.0.1:1080`. */
export function proxyLabel(network: Extract<BrowserNetwork, { kind: "proxy" }>): string {
    return `${network.protocol.toUpperCase()} ${network.host}:${network.port}`;
}

export const BrowserNetworkChannel = {
    /**
     * Apply a profile's network to its session partition. Must be awaited before
     * any page of that profile mounts a webview. Idempotent: an unchanged network
     * resolves without touching the session. Rejects when the proxy cannot be set;
     * the caller must then refuse to show the page rather than browse direct.
     * Renderer → Main (invoke). Args: (partition: string, network: BrowserNetwork)
     * Returns: BrowserNetworkApplyResult
     */
    apply: "browser-network:apply",

    /**
     * Look up the egress IP / location through a proxied profile session.
     * Renderer → Main (invoke). Args: (partition: string)
     * Returns: EgressIpInfo — never rejects; failures come back in `error`.
     */
    checkIp: "browser-network:check-ip",

    /**
     * Issue a one-URL `session-src` handle for a proxied profile or live Tor
     * partition, so a resource opened out of that page (e.g. "Open Image in New
     * Tab") is fetched through the page's session instead of direct.
     * Renderer → Main (invoke). Args: (partition: string, url: string)
     * Returns: string | undefined — undefined when the partition is not routed.
     */
    sessionSource: "browser-network:session-source",

    /**
     * Forget an Incognito page's partition when the page closes: its in-memory
     * session is per page, so main would otherwise keep one entry per closed page.
     * Renderer → Main (invoke). Args: (partition: string)
     */
    release: "browser-network:release",
} as const;
