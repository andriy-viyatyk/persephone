import type { WebContents } from "electron";

export type WebContentsGoneEvent = "destroyed" | "render-process-gone" | "did-navigate";
const ALL_EVENTS: readonly WebContentsGoneEvent[] = ["destroyed", "render-process-gone", "did-navigate"];

export interface WebContentsGoneOptions {
    readonly events?: readonly WebContentsGoneEvent[];
    readonly repeat?: boolean;
}

/** Calls `callback(event)` when the contents is destroyed, crashes, or navigates. Returns an idempotent `dispose`. */
export function onWebContentsGone(
    webContents: WebContents,
    callback: (event: WebContentsGoneEvent) => void,
    options: WebContentsGoneOptions = {},
): () => void {
    const listeners = new Map<WebContentsGoneEvent, () => void>();
    const dispose = (): void => {
        for (const [event, listener] of listeners) webContents.removeListener(event as "destroyed", listener);
        listeners.clear();
    };
    for (const event of options.events ?? ALL_EVENTS) {
        const listener = (): void => {
            if (event === "destroyed" || !options.repeat) dispose();
            callback(event);
        };
        listeners.set(event, listener);
        webContents.on(event as "destroyed", listener);
    }
    return dispose;
}
