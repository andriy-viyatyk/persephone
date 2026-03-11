/**
 * Simple rate limiter for popup/tab creation.
 * Tracks timestamps per key and blocks if too many requests within a time window.
 *
 * A single global instance (`globalPopupRateLimiter`) enforces an app-wide limit
 * of 3 popups/tabs per 2 seconds. This prevents cascade attacks where each new tab
 * opens more tabs, bypassing per-tab limits. Each process (main, renderer) gets its
 * own instance of the global singleton, which is fine — they guard different things
 * (renderer: internal tabs, main: popup BrowserWindows).
 */

const MAX_COUNT = 3;
const WINDOW_MS = 2000;

export class PopupRateLimiter {
    private timestamps = new Map<string, number[]>();
    private allowed = new Set<string>();

    /** Check if a request should be allowed. Returns true if allowed, false if rate-limited. */
    check(key: string): boolean {
        if (this.allowed.has(key)) return true;

        const now = Date.now();
        const cutoff = now - WINDOW_MS;

        let times = this.timestamps.get(key);
        if (!times) {
            times = [];
            this.timestamps.set(key, times);
        }

        // Remove expired timestamps
        while (times.length > 0 && times[0] <= cutoff) {
            times.shift();
        }

        if (times.length >= MAX_COUNT) {
            return false;
        }

        times.push(now);
        return true;
    }

    /** Mark a key as permanently allowed (until cleared). */
    allow(key: string): void {
        this.allowed.add(key);
        this.timestamps.delete(key);
    }

    /** Check if a key prefix is allowed. */
    isAllowed(keyPrefix: string): boolean {
        for (const key of this.allowed) {
            if (key === keyPrefix || key.startsWith(keyPrefix + "/")) return true;
        }
        return false;
    }

    /** Allow all keys starting with a prefix. */
    allowByPrefix(prefix: string): void {
        this.allowed.add(prefix);
        for (const key of this.timestamps.keys()) {
            if (key.startsWith(prefix)) {
                this.timestamps.delete(key);
            }
        }
    }

    /** Remove entries for a key prefix (cleanup). */
    removeByPrefix(prefix: string): void {
        for (const key of [...this.timestamps.keys()]) {
            if (key.startsWith(prefix)) this.timestamps.delete(key);
        }
        this.allowed.delete(prefix);
    }
}

/** App-wide global rate limiter — max 3 popups/tabs per 2 seconds across the entire app. */
export const globalPopupRateLimiter = new PopupRateLimiter();
