/**
 * IPC channel definitions for Tor proxy service.
 *
 * Renderer ↔ Main communication for starting/stopping the Tor process
 * and streaming tor.exe stdout to the renderer.
 */

export const TorChannel = {
    /**
     * Start Tor for a browser partition.
     * Renderer → Main (invoke).
     * Args: (torExePath: string, socksPort: number, partition: string)
     * Returns: { success: boolean; error?: string }
     */
    start: "tor:start",

    /**
     * Stop Tor for a browser partition (decrements consumer counter).
     * Renderer → Main (invoke).
     * Args: (partition: string)
     */
    stop: "tor:stop",

    /**
     * Tor log line event.
     * Main → Renderer (send).
     * Data: string (one log line from tor.exe stdout/stderr)
     */
    log: "tor:log",
} as const;
