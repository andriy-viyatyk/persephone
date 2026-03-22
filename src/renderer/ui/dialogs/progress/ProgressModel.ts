import { TGlobalState } from "../../../core/state/state";

interface ProgressItem {
    id: number;
    label: string;
}

interface ScreenLock {
    id: number;
}

interface ProgressState {
    items: ProgressItem[];
    notifications: ProgressItem[];
    locks: ScreenLock[];
}

export const progressState = new TGlobalState<ProgressState>({
    items: [],
    notifications: [],
    locks: [],
});

let nextId = 0;
const PROGRESS_DELAY = 300;

/**
 * Handle returned by createProgress(). Allows updating the label
 * and showing the overlay for a promise.
 */
export interface ProgressHandle {
    /** Update the progress label. Triggers UI re-render. */
    label: string;
    /**
     * Show the overlay while promise is pending. Auto-closes on resolve/reject.
     * Returns the same promise (pass-through) so the caller can await the result.
     * The overlay appears after a 300ms delay — if the promise resolves faster,
     * no overlay is shown (avoids blinking for quick operations).
     */
    show<T>(promise: Promise<T>): Promise<T>;
}

function updateItemLabel(id: number, label: string) {
    progressState.update(s => {
        const item = s.items.find(i => i.id === id);
        if (item) item.label = label;
    });
}

/**
 * Create a progress handle that can be used to update the label
 * and show the overlay for a promise.
 *
 * @example
 * const progress = createProgress("Starting...");
 * async function run() {
 *     progress.label = "Loading files...";
 *     // ... work ...
 *     progress.label = "Processing...";
 * }
 * await progress.show(run());
 */
export function createProgress(label: string): ProgressHandle {
    const id = ++nextId;
    let currentLabel = label;

    const handle: ProgressHandle = {
        get label() { return currentLabel; },
        set label(value: string) {
            currentLabel = value;
            updateItemLabel(id, value);
        },
        show<T>(promise: Promise<T>): Promise<T> {
            const item: ProgressItem = { id, label: currentLabel };
            let settled = false;

            const timer = setTimeout(() => {
                if (!settled) {
                    progressState.update(s => { s.items = [...s.items, item]; });
                }
            }, PROGRESS_DELAY);

            promise.finally(() => {
                settled = true;
                clearTimeout(timer);
                progressState.update(s => { s.items = s.items.filter(i => i.id !== id); });
            });

            return promise;
        },
    };

    return handle;
}

/**
 * Show blocking overlay with spinner while promise is pending.
 * Auto-closes when the promise resolves or rejects.
 * Returns the same promise (pass-through) so the caller can await the result.
 *
 * The overlay appears after a 300ms delay — if the promise resolves faster,
 * no overlay is shown (avoids blinking for quick operations).
 *
 * For updatable labels, use createProgress() instead.
 */
export function showProgress<T>(promise: Promise<T>, label: string): Promise<T> {
    return createProgress(label).show(promise);
}

/**
 * Show a brief centered notification that auto-dismisses after timeout.
 * Does not block user interaction.
 */
export function notifyProgress(label: string, timeout = 2000): void {
    const id = ++nextId;
    const item: ProgressItem = {
        id,
        label,
    };

    progressState.update(s => { s.notifications = [...s.notifications, item]; });

    setTimeout(() => {
        progressState.update(s => { s.notifications = s.notifications.filter(i => i.id !== id); });
    }, timeout);
}

/**
 * Lock the screen with a blocking overlay.
 * Returns a lock object — pass to removeScreenLock() to release.
 */
export function addScreenLock(): ScreenLock {
    const id = ++nextId;
    const lock: ScreenLock = { id };
    progressState.update(s => { s.locks = [...s.locks, lock]; });
    return lock;
}

/** Release a screen lock. */
export function removeScreenLock(lock: ScreenLock): void {
    const id = lock.id;
    progressState.update(s => { s.locks = s.locks.filter(l => l.id !== id); });
}
