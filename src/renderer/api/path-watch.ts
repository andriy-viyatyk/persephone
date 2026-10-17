import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { EventEndpoint, type PathWatchBatch, type PathWatchSubscribeRequest } from "../../ipc/api-types";
import { errMessage } from "../../shared/utils";

export interface PathWatchOptions {
    recursive?: boolean;
    debounceMs?: number;
    label: string;
}

/** Register a local filesystem move before mutating its source path. Best-effort: move tracking
 *  must never block or change the outcome of the move itself, so a failure returns undefined. */
export async function beginPathMove(from: string, to: string): Promise<string | undefined> {
    try {
        return await api.beginPathMove({ from, to });
    } catch {
        return undefined;
    }
}

/** Complete a previously registered local filesystem move. */
export async function completePathMove(moveId: string | undefined, succeeded: boolean): Promise<void> {
    if (!moveId) return;
    try {
        await api.completePathMove({ moveId, succeeded });
    } catch {
        // Unmatched intents expire in the service.
    }
}

interface LocalSubscription {
    key: string;
    clientId: string;
    request: PathWatchSubscribeRequest;
    callbacks: Map<symbol, (batch: PathWatchBatch) => void>;
    active: boolean;
    acknowledgment: Promise<void>;
}

const subscriptionsByKey = new Map<string, LocalSubscription>();
const subscriptionsByClient = new Map<string, LocalSubscription>();

function removeLocal(subscription: LocalSubscription): void {
    if (subscriptionsByKey.get(subscription.key) === subscription) subscriptionsByKey.delete(subscription.key);
    if (subscriptionsByClient.get(subscription.clientId) === subscription) subscriptionsByClient.delete(subscription.clientId);
    subscription.active = false;
}

function sendUnsubscribe(subscription: LocalSubscription): void {
    void subscription.acknowledgment.then(() => api.unsubscribePathWatch({ clientId: subscription.clientId }))
        .catch((error: unknown) => {
            console.warn(`Path-watch unsubscribe failed: ${errMessage(error)}`);
        });
}

function deliver(subscription: LocalSubscription, batch: PathWatchBatch): void {
    for (const callback of subscription.callbacks.values()) {
        try {
            callback(batch);
        } catch (error: unknown) {
            console.warn(`Path-watch callback failed: ${errMessage(error)}`);
        }
    }
    if (batch.ended) {
        removeLocal(subscription);
        subscription.callbacks.clear();
        sendUnsubscribe(subscription);
    }
}

rendererEvents[EventEndpoint.ePathWatchBatch].subscribe(event => {
    const subscription = subscriptionsByClient.get(event.clientId);
    if (!subscription?.active) return;
    deliver(subscription, event.batch);
});

/** Subscribe to a local file or folder. Equivalent local subscriptions share one IPC lease. */
export function subscribe(
    targetPath: string,
    callback: (batch: PathWatchBatch) => void,
    options: PathWatchOptions,
): () => void {
    const recursive = options.recursive ?? false;
    const requestedDebounce = options.debounceMs ?? 300;
    const debounceMs = Number.isFinite(requestedDebounce) ? Math.max(50, Math.floor(requestedDebounce)) : 300;
    const key = JSON.stringify([targetPath, recursive, debounceMs]);
    let subscription = subscriptionsByKey.get(key);
    let callbackKey: symbol;

    if (subscription) {
        callbackKey = Symbol("path-watch-callback");
        subscription.callbacks.set(callbackKey, callback);
    } else {
        const clientId = crypto.randomUUID();
        const request: PathWatchSubscribeRequest = {
            clientId,
            path: targetPath,
            recursive,
            debounceMs,
            label: options.label,
        };
        const callbacks = new Map<symbol, (batch: PathWatchBatch) => void>();
        callbackKey = Symbol("path-watch-callback");
        callbacks.set(callbackKey, callback);
        subscription = {
            key,
            clientId,
            request,
            callbacks,
            active: true,
            acknowledgment: Promise.resolve(),
        };
        subscriptionsByKey.set(key, subscription);
        subscriptionsByClient.set(clientId, subscription);
        subscription.acknowledgment = api.subscribePathWatch(request).catch((error: unknown) => {
            if (subscription?.active && subscriptionsByClient.get(clientId) === subscription) {
                deliver(subscription, { changes: [], ended: "error" });
            }
            // Main's request/reply handler reports a useful error to its caller; the public API
            // reports unsupported paths through the same terminal batch as watcher failures.
            console.warn(`Path-watch subscribe failed: ${errMessage(error)}`);
        });
    }

    const currentSubscription = subscription;
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        currentSubscription.callbacks.delete(callbackKey);
        if (currentSubscription.callbacks.size > 0) return;
        removeLocal(currentSubscription);
        sendUnsubscribe(currentSubscription);
    };
}

export default { subscribe };
