import { WebContents } from "electron";

export type CdpEventHandler = (method: string, params: unknown, sessionId: string | undefined) => void;
export type CdpFeatureTarget =
    | { kind: "app"; webContents?: WebContents; cdp?: CdpTarget; attach: (wc: WebContents) => CdpTarget }
    | { kind: "board"; registration: import("../board-host/BoardFrameRegistry").BoardFrameRegistration; webContents: WebContents; cdp: CdpTarget; attach: (wc: WebContents) => CdpTarget }
    | { kind: "browser"; webContents?: WebContents; cdp?: CdpTarget; attach: (wc: WebContents) => CdpTarget };
type DebuggerMessageHandler = (
    event: Electron.Event,
    method: string,
    params: unknown,
    sessionId: string,
) => void;

interface CdpEventDispatcher {
    handler: DebuggerMessageHandler;
    subscribers: Set<CdpEventHandler>;
}

const targets = new WeakMap<WebContents, CdpTarget>();

/** Owns the shared debugger lifecycle for one WebContents. */
export class CdpTarget {
    public static for(webContents: WebContents): CdpTarget {
        let target = targets.get(webContents);
        if (!target) {
            target = new CdpTarget(webContents);
            targets.set(webContents, target);
        }
        return target;
    }

    private isAttached = false;
    private dispatcher?: CdpEventDispatcher;
    private readonly enabledDomains = new Map<string, Set<string>>();
    private readonly enablingDomains = new Map<string, Map<string, Promise<void>>>();
    private detachHandler?: () => void;
    private detachCallbacks = new Set<() => void>();

    private constructor(private readonly webContents: WebContents) {}

    public get attached(): boolean {
        return this.isAttached;
    }

    public ensureAttached(): boolean {
        if (this.isAttached) return false;
        this.webContents.debugger.attach("1.3");
        this.isAttached = true;
        this.detachCallbacks = new Set();
        const detachHandler = () => this.handleDetach(detachHandler);
        this.detachHandler = detachHandler;
        this.webContents.debugger.on("detach", detachHandler);
        return true;
    }

    /** Registers feature cleanup for the current attach session. */
    public onDetached(callback: () => void): () => void {
        const callbacks = this.detachCallbacks;
        callbacks.add(callback);
        let registered = true;
        return () => {
            if (!registered) return;
            registered = false;
            callbacks.delete(callback);
        };
    }

    public async enableDomain(domain: "Page" | "Runtime" | "Network", sessionId?: string): Promise<void> {
        const sessionKey = sessionId ?? "";
        let domains = this.enabledDomains.get(sessionKey);
        if (!domains) {
            domains = new Set();
            this.enabledDomains.set(sessionKey, domains);
        }
        if (domains.has(domain)) return;
        let pendingDomains = this.enablingDomains.get(sessionKey);
        if (!pendingDomains) {
            pendingDomains = new Map();
            this.enablingDomains.set(sessionKey, pendingDomains);
        }
        const existing = pendingDomains.get(domain);
        if (existing) return existing;
        const params = domain === "Network"
            ? { maxTotalBufferSize: 20 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024 }
            : {};
        const pending = this.webContents.debugger.sendCommand(`${domain}.enable`, params, sessionId)
            .then(() => { domains.add(domain); })
            .finally(() => { pendingDomains?.delete(domain); });
        pendingDomains.set(domain, pending);
        return pending;
    }

    public subscribeCdpEvents(handler: CdpEventHandler): () => void {
        let dispatcher = this.dispatcher;
        if (!dispatcher) {
            const subscribers = new Set<CdpEventHandler>();
            const messageHandler: DebuggerMessageHandler = (_event, method, params, sessionId) => {
                for (const subscriber of [...subscribers]) subscriber(method, params, sessionId || undefined);
            };
            dispatcher = { handler: messageHandler, subscribers };
            this.dispatcher = dispatcher;
            this.webContents.debugger.on("message", messageHandler);
        }
        dispatcher.subscribers.add(handler);
        let subscribed = true;
        return () => {
            if (!subscribed) return;
            subscribed = false;
            const current = this.dispatcher;
            if (!current) return;
            current.subscribers.delete(handler);
            if (current.subscribers.size === 0) {
                this.removeMessageListener(current.handler);
                if (this.dispatcher === current) this.dispatcher = undefined;
            }
        };
    }

    public detach(): void {
        if (!this.isAttached) return;
        const handler = this.detachHandler;
        try {
            this.webContents.debugger.detach();
        } catch {
            // The debugger may already have detached.
        }
        if (this.isAttached && handler) this.handleDetach(handler);
    }

    private handleDetach(handler: () => void): void {
        if (this.detachHandler !== handler) return;
        this.isAttached = false;
        this.detachHandler = undefined;
        const callbacks = this.detachCallbacks;
        this.detachCallbacks = new Set();
        for (const callback of callbacks) callback();
        this.clearCdpSubscriptions();
        this.enabledDomains.clear();
        this.removeDetachListener(handler);
    }

    private clearCdpSubscriptions(): void {
        const dispatcher = this.dispatcher;
        if (!dispatcher) return;
        this.removeMessageListener(dispatcher.handler);
        dispatcher.subscribers.clear();
        this.dispatcher = undefined;
    }

    private removeMessageListener(handler: DebuggerMessageHandler): void {
        try {
            if (!this.webContents.isDestroyed()) this.webContents.debugger.removeListener("message", handler);
        } catch {
            // WebContents may already be destroyed.
        }
    }

    private removeDetachListener(handler: () => void): void {
        try {
            if (!this.webContents.isDestroyed()) this.webContents.debugger.removeListener("detach", handler);
        } catch {
            // WebContents may already be destroyed.
        }
    }
}
