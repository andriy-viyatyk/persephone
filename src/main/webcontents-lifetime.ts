import type { WebContents } from "electron";

export type WebContentsGoneEvent = "destroyed" | "render-process-gone" | "did-navigate";
const ALL_EVENTS: readonly WebContentsGoneEvent[] = ["destroyed", "render-process-gone", "did-navigate"];

export interface WebContentsGoneOptions {
    readonly events?: readonly WebContentsGoneEvent[];
    readonly repeat?: boolean;
}

/** One onWebContentsGone() call; it is listed under each of its events. */
interface Subscription {
    readonly callback: (event: WebContentsGoneEvent) => void;
    readonly repeat: boolean;
    readonly dispose: () => void;
    active: boolean;
}

/** One native listener per WebContents and event, fanning out to the subscriptions. */
interface EventListeners {
    readonly subscriptions: Set<Subscription>;
    readonly listener: () => void;
}

const listenersByContents = new WeakMap<WebContents, Map<WebContentsGoneEvent, EventListeners>>();

function removeSubscription(webContents: WebContents, event: WebContentsGoneEvent, subscription: Subscription): void {
    const listeners = listenersByContents.get(webContents);
    const registered = listeners?.get(event);
    if (!listeners || !registered) return;
    registered.subscriptions.delete(subscription);
    if (registered.subscriptions.size > 0) return;
    webContents.removeListener(event as "destroyed", registered.listener);
    listeners.delete(event);
    if (listeners.size === 0) listenersByContents.delete(webContents);
}

function eventListeners(webContents: WebContents, event: WebContentsGoneEvent): EventListeners {
    let listeners = listenersByContents.get(webContents);
    if (!listeners) {
        listeners = new Map();
        listenersByContents.set(webContents, listeners);
    }
    let registered = listeners.get(event);
    if (!registered) {
        const subscriptions = new Set<Subscription>();
        const listener = (): void => {
            for (const subscription of [...subscriptions]) {
                if (!subscription.active) continue;
                if (event === "destroyed" || !subscription.repeat) subscription.dispose();
                subscription.callback(event);
            }
        };
        registered = { subscriptions, listener };
        listeners.set(event, registered);
        webContents.on(event as "destroyed", listener);
    }
    return registered;
}

/**
 * Calls `callback(event)` when the contents is destroyed, crashes, or navigates. Returns an idempotent `dispose`.
 * Without `repeat`, the first event ends the subscription; `destroyed` always ends it. Every subscriber on a
 * WebContents shares one native listener per event, so many concurrent subscriptions never stack listeners.
 */
export function onWebContentsGone(
    webContents: WebContents,
    callback: (event: WebContentsGoneEvent) => void,
    options: WebContentsGoneOptions = {},
): () => void {
    const events = [...new Set(options.events ?? ALL_EVENTS)];
    const subscription: Subscription = {
        callback,
        repeat: options.repeat === true,
        active: true,
        dispose: () => {
            if (!subscription.active) return;
            subscription.active = false;
            for (const event of events) removeSubscription(webContents, event, subscription);
        },
    };
    for (const event of events) eventListeners(webContents, event).subscriptions.add(subscription);
    return subscription.dispose;
}
