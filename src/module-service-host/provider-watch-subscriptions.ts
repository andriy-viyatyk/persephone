import type { ProviderResult, ProviderWireErrorCode } from "../ipc/module-service-channels";
import type { RendererLease, ProviderSubscription } from "./renderer-lease";
import { errMessage } from "../shared/utils";

export function providerWatchKey(type: string, subscriptionId: string, treePath?: string): string {
    return treePath === undefined
        ? `${type}\u0000${subscriptionId}`
        : `tree-watch\u0000${type}\u0000${subscriptionId}`;
}

export function unsubscribeProviderWatch(lease: RendererLease, key: string): ProviderResult {
    const subscription = lease.subscriptions.get(key);
    if (subscription) {
        lease.subscriptions.delete(key);
        try {
            subscription.dispose();
        } catch (error: unknown) {
            return failure("provider-failed", errMessage(error, "watch disposer failed."));
        }
    }
    return { kind: "provider-result", operation: "watchUnsubscribe", ok: true };
}

export function subscribeProviderWatch(
    lease: RendererLease,
    key: string,
    subscriptionId: string,
    isLeaseCurrent: () => boolean,
    postEvent: (event: unknown) => void,
    register: (onChange: (event: unknown) => void) => unknown,
): ProviderResult {
    const previous = lease.subscriptions.get(key);
    if (previous) {
        lease.subscriptions.delete(key);
        try { previous.dispose(); } catch { /* A replaced watch is torn down best effort. */ }
    }
    const subscription: ProviderSubscription = {
        dispose: (): void => undefined,
        clear: (): void => undefined,
        lastSentAt: 0,
    };
    const isCurrent = (): boolean => isLeaseCurrent() && lease.subscriptions.get(key) === subscription;
    lease.subscriptions.set(key, subscription);
    let disposer: unknown;
    try {
        disposer = register((event: unknown): void => {
            if (isCurrent()) postEvent(event);
        });
    } catch (error: unknown) {
        if (lease.subscriptions.get(key) === subscription) lease.subscriptions.delete(key);
        return failure("provider-failed", errMessage(error, "watch() failed."));
    }
    if (typeof disposer !== "function") {
        if (lease.subscriptions.get(key) === subscription) lease.subscriptions.delete(key);
        return failure("provider-invalid-result", "watch() must return a disposer function.");
    }
    subscription.dispose = (): void => {
        try { disposer(); } catch { /* Lease teardown is best effort. */ }
    };
    return { kind: "provider-result", operation: "watchSubscribe", ok: true };
}

function failure(code: ProviderWireErrorCode, message: string): Extract<ProviderResult, { ok: false }> {
    return { kind: "provider-result", ok: false, error: { kind: "provider-error", code, message } };
}
