import { powerMonitor } from "electron";

/**
 * Linux lock detection. Electron emits `lock-screen` / `unlock-screen` only on Windows and macOS, but on GNOME
 * `powerMonitor.getSystemIdleState()` reports "locked" while the screen shield is up, so the state is sampled.
 */

/** How often the lock state is sampled; a lock or unlock is reported at most this late. */
const LOCK_POLL_INTERVAL_MS = 2000;
/** Idle threshold passed to getSystemIdleState; only its "locked" answer is used. */
const IDLE_THRESHOLD_SECONDS = 60;

export function isSessionLocked(): boolean {
    return powerMonitor.getSystemIdleState(IDLE_THRESHOLD_SECONDS) === "locked";
}

/** Calls `onChange` with the sampled lock state; returns the function that stops sampling. */
export function watchLinuxSessionLock(onChange: (locked: boolean) => void): () => void {
    const timer = setInterval(() => onChange(isSessionLocked()), LOCK_POLL_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
}
