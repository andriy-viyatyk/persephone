import type { MessageEvent as ElectronMessageEvent, MessagePortMain } from "electron";
import type { ProviderOperation, RendererLeaseLostReason, RendererServiceMessage, ServiceMainMessage, ServiceParentMessage } from "../ipc/module-service-channels";
import { CAPABILITY_DEFAULT_TIMEOUT_MS } from "../shared/capability-limits";
import { eventData, isRecord } from "./validation";
import type { ProviderStatusSnapshot } from "./provider-dispatch";

export interface RendererRequestState {
    controller?: AbortController;
    isContentRead: boolean;
    operation: ProviderOperation;
}

export interface ProviderSubscription {
    dispose(): void;
    clear(): void;
    timer?: ReturnType<typeof setTimeout>;
    pending?: ProviderStatusSnapshot | null;
    lastSentAt: number;
    settingUp?: boolean;
}

export interface RendererLease {
    generation: number;
    leaseNonce: string;
    port: MessagePortMain;
    attached: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
    pending: Map<string, RendererRequestState>;
    subscriptions: Map<string, ProviderSubscription>;
    activeContentReads: number;
}

export interface RendererLeaseManager {
    values(): IterableIterator<RendererLease>;
    get(leaseNonce: string): RendererLease | undefined;
    isCurrent(lease: RendererLease): boolean;
    post(lease: RendererLease, message: RendererServiceMessage): boolean;
    adjustContentReads(lease: RendererLease, amount: number): void;
    close(lease: RendererLease | undefined, reason: RendererLeaseLostReason): void;
    attach(message: Extract<ServiceParentMessage, { kind: "attach-renderer" }>, port: MessagePortMain | undefined): void;
    drop(message: Extract<ServiceParentMessage, { kind: "drop-renderer" }>): void;
    closeAll(reason: RendererLeaseLostReason): void;
}

export function createRendererLeaseManager(dependencies: {
    postMain(message: ServiceMainMessage): void;
    announceCapabilities(lease: RendererLease): void;
    handleRequest(lease: RendererLease, message: unknown): void;
}): RendererLeaseManager {
    const leases = new Map<string, RendererLease>();

    function isCurrent(lease: RendererLease): boolean {
        return leases.get(lease.leaseNonce) === lease;
    }

    function post(lease: RendererLease, message: RendererServiceMessage): boolean {
        try {
            lease.port.postMessage(message);
            return true;
        } catch {
            return false;
        }
    }

    function adjustContentReads(lease: RendererLease, amount: number): void {
        lease.activeContentReads = Math.max(0, lease.activeContentReads + amount);
        if (lease.attached) post(lease, { kind: "content-read-count", count: lease.activeContentReads });
    }

    function disposeSubscriptions(lease: RendererLease): void {
        for (const subscription of lease.subscriptions.values()) {
            try { subscription.dispose(); }
            catch { /* Process teardown is best effort; the utility process owns the resources. */ }
        }
        lease.subscriptions.clear();
    }

    function settlePending(lease: RendererLease, reason: RendererLeaseLostReason): void {
        for (const [requestId, pending] of lease.pending) {
            pending.controller?.abort();
            post(lease, { kind: "response", requestId, error: { code: reason, message: `The service renderer lease was lost: ${reason}.` } });
            lease.pending.delete(requestId);
        }
    }

    function close(lease: RendererLease | undefined, reason: RendererLeaseLostReason): void {
        if (!lease || !isCurrent(lease)) return;
        clearTimeout(lease.timer);
        post(lease, { kind: "lease-lost", reason });
        settlePending(lease, reason);
        disposeSubscriptions(lease);
        lease.activeContentReads = 0;
        leases.delete(lease.leaseNonce);
        try { lease.port.close(); }
        catch { /* The other endpoint may already have closed. */ }
    }

    function attach(message: Extract<ServiceParentMessage, { kind: "attach-renderer" }>, port: MessagePortMain | undefined): void {
        if (!port || typeof port.postMessage !== "function" || typeof port.close !== "function" || typeof port.on !== "function") return;
        if (!Number.isInteger(message.generation) || typeof message.leaseNonce !== "string") return;
        const lease: RendererLease = {
            generation: message.generation,
            leaseNonce: message.leaseNonce,
            port,
            attached: false,
            pending: new Map(),
            subscriptions: new Map(),
            timer: undefined,
            activeContentReads: 0,
        };
        leases.set(lease.leaseNonce, lease);
        lease.timer = setTimeout((): void => close(lease, "renderer-port-attach-failed"), CAPABILITY_DEFAULT_TIMEOUT_MS);
        try {
            port.on("message", (event: ElectronMessageEvent): void => {
                const nested = eventData(event);
                if (!isRecord(nested)) return;
                if (nested.kind === "hello-ack") {
                    if (!isCurrent(lease) || lease.attached || nested.generation !== lease.generation || nested.leaseNonce !== lease.leaseNonce) return;
                    lease.attached = true;
                    clearTimeout(lease.timer);
                    dependencies.postMain({ kind: "renderer-attached", generation: lease.generation, leaseNonce: lease.leaseNonce });
                    dependencies.announceCapabilities(lease);
                    return;
                }
                if (nested.kind === "cancel" && typeof nested.requestId === "string") {
                    const pending = lease.pending.get(nested.requestId);
                    if (pending) {
                        lease.pending.delete(nested.requestId);
                        if (pending.isContentRead) adjustContentReads(lease, -1);
                        pending.controller?.abort();
                    }
                    return;
                }
                dependencies.handleRequest(lease, nested);
            });
            // Electron's MessagePortMain declaration omits the runtime messageerror event.
            (port as MessagePortMain & { on(event: "messageerror", listener: () => void): MessagePortMain })
                .on("messageerror", (): void => close(lease, "service-exited"));
            port.start();
            post(lease, { kind: "hello", generation: lease.generation, leaseNonce: lease.leaseNonce });
        } catch {
            close(lease, "service-exited");
        }
    }

    return {
        values: (): IterableIterator<RendererLease> => leases.values(),
        get: (leaseNonce: string): RendererLease | undefined => leases.get(leaseNonce),
        isCurrent,
        post,
        adjustContentReads,
        close,
        attach,
        drop(message): void {
            const lease = leases.get(message.leaseNonce);
            if (!lease || message.generation !== lease.generation) return;
            close(lease, message.reason);
        },
        closeAll(reason): void {
            for (const lease of [...leases.values()]) close(lease, reason);
        },
    };
}
