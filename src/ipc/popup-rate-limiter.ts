/**
 * Simple rate limiter for popup/tab creation.
 * Tracks timestamps per key and blocks if too many requests within a time window.
 *
 * A single global instance (`globalPopupRateLimiter`) enforces an app-wide limit of 3 page-opened
 * popups/tabs per 2 seconds per key. This prevents cascade attacks where each new tab opens more tabs,
 * bypassing per-tab limits. The main process owns the check for browser pages (`BrowserPopupGate`,
 * keys "tabs" and "popups"); a user's "Allow popups" is a per-tab grant there, never a key here.
 */

const MAX_COUNT = 3;
const WINDOW_MS = 2000;

export class PopupRateLimiter {
    private timestamps = new Map<string, number[]>();

    /** Check if a request should be allowed. Returns true if allowed, false if rate-limited. */
    check(key: string): boolean {
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
}

/** App-wide global rate limiter — max 3 popups/tabs per 2 seconds across the entire app. */
export const globalPopupRateLimiter = new PopupRateLimiter();
