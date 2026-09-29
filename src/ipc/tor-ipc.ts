/**
 * IPC channel definitions for Tor proxy service.
 *
 * Renderer ↔ Main communication for starting/stopping the Tor process
 * and streaming tor.exe stdout to the renderer.
 */
import type { EgressIpInfo } from "./browser-network-ipc";

/** Tor connection status for a browser page. */
export type TorStatus = "disconnected" | "connecting" | "connected" | "error";

/**
 * Result of a `tor:check-ip` lookup — what the outside world sees for this
 * Tor session, plus whether it really exits through Tor.
 */
export interface TorIpInfo extends EgressIpInfo {
    /** check.torproject.org's verdict; null when that call failed. */
    isTor: boolean | null;
}

export const TorChannel = {
    /**
     * Apply the SOCKS proxy to a browser partition *before* the Tor daemon is up.
     * Renderer → Main (invoke).
     *
     * This is what makes a Tor page fail **closed**. A partition with no proxy
     * goes DIRECT in Chromium, so anything that loads between page creation and
     * `Bootstrapped 100%` — or after a failed bootstrap — would otherwise reach
     * the network unproxied. Arming points the session at a SOCKS port that is
     * not listening yet, turning that window into ERR_SOCKS_CONNECTION_FAILED.
     *
     * Must be awaited before the page is added to the window, i.e. before any
     * webview can mount. Arming alone does not make the partition a live Tor
     * session — `tor:start` still has to bootstrap the daemon.
     *
     * Args: (socksPort: number, partition: string)
     */
    arm: "tor:arm",

    /**
     * Start Tor for a browser partition.
     * Renderer → Main (invoke).
     * Args: (torExePath: string, socksPort: number, partition: string)
     * Returns: { success: boolean; error?: string }
     */
    start: "tor:start",

    /** Acquire a sender-owned Tor daemon lease for a routed fetch. */
    fetchAcquire: "tor:fetch-acquire",
    /** Release one sender-owned Tor daemon lease. */
    fetchRelease: "tor:fetch-release",

    /**
     * Stop Tor for a browser partition (decrements consumer counter).
     * Renderer → Main (invoke).
     * Args: (partition: string)
     */
    stop: "tor:stop",

    /**
     * Look up the exit IP / location for a Tor partition (US-897).
     * Renderer → Main (invoke).
     * Args: (partition: string)
     * Returns: TorIpInfo — never rejects; failures come back in `error`.
     */
    checkIp: "tor:check-ip",

    /**
     * Restart tor.exe so fresh circuits (and normally a new exit IP) are used,
     * then re-apply the proxy to every active Tor partition (US-897).
     * Renderer → Main (invoke). Resolves only after the new daemon bootstraps,
     * which can take tens of seconds.
     * Args: (partition: string)
     * Returns: { success: boolean; error?: string }
     */
    restart: "tor:restart",

    /**
     * Tor log line event.
     * Main → Renderer (send).
     * Data: string (one log line from tor.exe stdout/stderr)
     */
    log: "tor:log",

    /**
     * Tor status change originating in main (US-897).
     * Main → Renderer (send), broadcast to every window.
     *
     * Only a restart emits this: the daemon is shared by all Tor pages, so a
     * restart triggered by one page takes the network down for the others, whose
     * `torStatus` lives in renderer state that main cannot see. Without this
     * broadcast those pages would keep showing a green "connected" dot while Tor
     * is down. The initial `tor:start` still drives status via its invoke result.
     *
     * Data: { status: TorStatus; error?: string }
     */
    status: "tor:status",
} as const;
