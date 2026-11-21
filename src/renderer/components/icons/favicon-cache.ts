const https = require("https");
const http = require("http");
const dns = require("dns").promises as typeof import("dns/promises");
const net = require("net") as typeof import("net");

import { fs } from "../../api/fs";
import { isPrivateAddress, pinnedLookup, type BoardNetworkAddress } from "../../../shared/board-network-guard";

// =============================================================================
// In-memory cache: hostname → file path (or "" for known misses)
// =============================================================================

const memoryCache = new Map<string, string>();

// Set of hostnames currently being fetched (avoid duplicate requests)
const pendingFetches = new Set<string>();

// Listeners waiting for a favicon to be saved for a hostname
const listeners = new Map<string, Array<() => void>>();

// Hostnames requested for favicon saving (e.g. from "Open in Internal Browser")
const saveForHosts = new Set<string>();

// Known favicon file extensions (tried in order during disk lookup)
const FAVICON_EXTENSIONS = [".ico", ".png", ".svg"];

// =============================================================================
// Public API
// =============================================================================

/**
 * Request that the favicon for a hostname be saved when the Browser loads it.
 * Call before opening a URL in the internal browser.
 */
export function requestFaviconSave(hostname: string): void {
    if (hostname) saveForHosts.add(hostname);
}

/**
 * Check if a hostname was requested for favicon saving, and consume the request.
 * Returns true once per hostname (removes it from the set).
 */
export function consumeFaviconSaveRequest(hostname: string): boolean {
    return saveForHosts.delete(hostname);
}

/** Extract hostname from a URL. Returns empty string on failure. */
export function getHostname(url: string): string {
    // Hostname grouping / favicons are meaningful only for web links. A canonical
    // mneme:// document link parses to a bogus host (the root name) and must not
    // enter the Hostnames panel or trigger a favicon fetch.
    if (url.startsWith("mneme://")) return "";
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

/**
 * Get the cached favicon file path for a hostname.
 * Returns the file path if cached, null otherwise.
 * Uses in-memory map first, then checks disk.
 */
export async function getFaviconPath(hostname: string): Promise<string | null> {
    if (!hostname) return null;

    const cached = memoryCache.get(hostname);
    if (cached !== undefined) {
        return cached || null; // "" means known miss
    }

    // Try each known extension
    const basePath = await fs.cacheMiscFilePath(`favicons/${hostname}`);
    for (const ext of FAVICON_EXTENSIONS) {
        const filePath = basePath + ext;
        if (fs.fileExistsSync(filePath)) {
            memoryCache.set(hostname, filePath);
            return filePath;
        }
    }

    return null;
}

/**
 * Get the cached favicon file path synchronously (from memory cache only).
 * Returns the file path if known, null otherwise.
 * Does not check disk — use getFaviconPath for the async version.
 */
export function getFaviconPathSync(hostname: string): string | null {
    if (!hostname) return null;
    const cached = memoryCache.get(hostname);
    if (cached) return cached; // skip "" (known misses) and undefined
    return null;
}

/**
 * Save a favicon from its URL to the cache.
 * Downloads the image and saves it as a binary file.
 * No-op if already cached for this hostname.
 *
 * `routedUrl` is the same favicon wrapped in a route scheme such as
 * `profile-src://` — set for a proxied browser profile, whose favicon must be
 * fetched through the profile session. It is read with Chromium `fetch()`; with
 * no route the download uses Node http(s) directly, refusing a private-address
 * target other than the page's own host (`hostname`) on every hop.
 */
export async function saveFavicon(hostname: string, faviconUrl: string, routedUrl?: string): Promise<void> {
    if (!hostname || !faviconUrl) return;

    // Already cached or known miss
    if (memoryCache.has(hostname)) return;

    // Already being fetched
    if (pendingFetches.has(hostname)) return;

    // Check if already on disk (any extension)
    const basePath = await fs.cacheMiscFilePath(`favicons/${hostname}`);
    for (const ext of FAVICON_EXTENSIONS) {
        const existing = basePath + ext;
        if (fs.fileExistsSync(existing)) {
            memoryCache.set(hostname, existing);
            return;
        }
    }

    pendingFetches.add(hostname);
    try {
        const buffer = routedUrl
            ? await fetchToBuffer(routedUrl)
            : await downloadToBuffer(faviconUrl, hostname);
        if (buffer && buffer.length > 0) {
            const ext = detectImageExtension(buffer);
            const filePath = basePath + ext;
            await fs.saveBinaryFile(filePath, buffer);
            memoryCache.set(hostname, filePath);
            notifyListeners(hostname);
        } else {
            memoryCache.set(hostname, ""); // known miss
        }
    } catch {
        memoryCache.set(hostname, ""); // known miss
    } finally {
        pendingFetches.delete(hostname);
    }
}

/**
 * Subscribe to favicon availability for a hostname.
 * Calls the callback when the favicon becomes available.
 * Returns an unsubscribe function.
 */
export function onFaviconReady(hostname: string, callback: () => void): () => void {
    if (!hostname) return () => {};
    let list = listeners.get(hostname);
    if (!list) {
        list = [];
        listeners.set(hostname, list);
    }
    list.push(callback);
    return () => {
        const arr = listeners.get(hostname);
        if (arr) {
            const idx = arr.indexOf(callback);
            if (idx >= 0) arr.splice(idx, 1);
            if (arr.length === 0) listeners.delete(hostname);
        }
    };
}


// =============================================================================
// Internal helpers
// =============================================================================

function notifyListeners(hostname: string) {
    const list = listeners.get(hostname);
    if (list) {
        listeners.delete(hostname);
        for (const cb of list) {
            try { cb(); } catch { /* ignore */ }
        }
    }
}

/** Detect image type from buffer magic bytes and return the appropriate extension. */
function detectImageExtension(buffer: Buffer): string {
    if (buffer.length >= 4) {
        // PNG: 89 50 4E 47
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return ".png";
        }
        // ICO: 00 00 01 00
        if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
            return ".ico";
        }
    }
    // SVG: text starting with <svg or <?xml
    const head = buffer.slice(0, 200).toString("utf8").trimStart();
    if (head.startsWith("<svg") || head.startsWith("<?xml")) {
        return ".svg";
    }
    // Default to .png (most common favicon format)
    return ".png";
}

async function fetchToBuffer(url: string): Promise<Buffer | null> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return null;
        return Buffer.from(await response.arrayBuffer());
    } catch {
        return null;
    }
}

/**
 * Addresses `url` may be fetched from, or null when the favicon cache must not request it.
 *
 * The favicon URL is chosen by the page, but this GET comes from the host process, so it must
 * not let a public page aim the host at loopback, the LAN or link-local services: a target that
 * resolves to a private address is refused unless it is the page's own host (a page served from
 * `localhost` or an intranet name keeps its favicon). The caller connects through
 * `pinnedLookup(addresses)`, so the checked address is the one used.
 */
async function allowedFaviconAddresses(url: URL, pageHost: string): Promise<BoardNetworkAddress[] | null> {
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const family = net.isIP(host);
    let addresses: BoardNetworkAddress[];
    try {
        addresses = family ? [{ address: host, family }] : await dns.lookup(host, { all: true, verbatim: true });
    } catch {
        return null;
    }
    if (!addresses.length) return null;
    const ownHost = url.hostname.toLowerCase() === pageHost.toLowerCase();
    if (!ownHost && addresses.some(({ address }) => isPrivateAddress(address, net.isIP))) return null;
    return addresses;
}

async function downloadToBuffer(address: string, pageHost: string, redirectsLeft = 1): Promise<Buffer | null> {
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        return null;
    }
    const addresses = await allowedFaviconAddresses(url, pageHost);
    if (!addresses) return null;
    return new Promise((resolve) => {
        const protocol = url.protocol === "https:" ? https : http;
        const lookup = pinnedLookup(addresses) as unknown as typeof import("dns").lookup;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const request = protocol.get(url, { timeout: 5000, lookup }, (res: any) => {
            // Follow one redirect; the target is checked like the first hop.
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                res.resume();
                if (redirectsLeft <= 0) {
                    resolve(null);
                    return;
                }
                let next: string;
                try {
                    next = new URL(res.headers.location, url).href;
                } catch {
                    resolve(null);
                    return;
                }
                downloadToBuffer(next, pageHost, redirectsLeft - 1).then(resolve);
                return;
            }
            if (res.statusCode !== 200) {
                resolve(null);
                return;
            }
            const chunks: Buffer[] = [];
        // The HTTP response/request owns these callbacks until completion or failure;
        // they are short-lived request resources, not view/model subscriptions.
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", () => resolve(null));
        });
        request.on("error", () => resolve(null));
        request.on("timeout", () => {
            request.destroy();
            resolve(null);
        });
    });
}
