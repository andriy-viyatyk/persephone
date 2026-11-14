/**
 * `tor-src://` protocol handler.
 *
 * Tor mode is a per-browser-page Electron session partition carrying a SOCKS5
 * proxy (see `tor-service.ts`). That proxy covers the page's `<webview>` only —
 * anything the app renderer draws itself goes out over the app session
 * and leaks the user's real IP. The Link editor rendered on a Tor page's blank
 * tab is exactly that case: its bookmark images are plain `<img src="https://…">`.
 *
 * This handler lets renderer content opt a single URL into a Tor page's session:
 *
 *     tor-src://<partition>/?u=<encodeURIComponent(originalUrl)>
 *
 * Deliberately NOT restricted to images — it is a generic "fetch this through
 * that Tor partition" primitive, hence the name. The three guards below are what
 * keep it safe, and they are load-bearing:
 *
 *   1. the partition must look like a Tor browser partition,
 *   2. it must be a *currently live* Tor partition (so the scheme is inert
 *      whenever no Tor page is running), and
 *   3. the target must be http(s).
 *
 * Together they mean a caller can only reach what it could already reach by
 * opening a Tor browser tab — no new capability, just correct routing. Removing
 * any of them turns this into an open proxy for arbitrary renderer content.
 */
import { session } from "electron";
import { torService } from "./tor-service";
import { createRoutedFetchHandler } from "./routed-fetch-protocol";

/** Shape produced by `getPartitionString` for a Tor page: `browser-tor-<uuid>`. */
const TOR_PARTITION_RE = /^browser-tor-[0-9a-f-]+$/;

/** Register the handler on a session. Call once per app session at startup. */
export function registerTorSrcProtocol(partition: string): void {
    session.fromPartition(partition).protocol.handle("tor-src", createRoutedFetchHandler({
        scheme: "tor-src",
        resolvePartition: host => {
            // These guards keep the scheme inert unless it routes through a live Tor page.
            if (!TOR_PARTITION_RE.test(host)) return { status: 403, body: "Not a Tor partition" };
            if (!torService.isActiveTorPartition(host)) {
                return { status: 403, body: "No live Tor session for this partition" };
            }
            return { partition: host };
        },
        failurePrefix: "Tor fetch failed",
        // The Tor partition carries the SOCKS5 proxy. No header rewriting or UA/Referer spoofing.
        // Only the body and content type are forwarded; Set-Cookie and other headers are dropped.
        // The app session is in-memory, and no-store keeps Tor-fetched bytes out of its cache.
    }));
}
