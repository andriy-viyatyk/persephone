import type { ParentPort } from "electron";
import type { ServiceParentMessage } from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import type { HostMessageListener, HostRawPortMethod } from "./validation";

/**
 * Compatibility for board services that use raw parentPort message listeners:
 * intercepts listener methods and preserves queued lifecycle events. Remove
 * only when no bundled board uses the raw protocol, after a separate user decision.
 */
interface EntryListener {
    listener: HostMessageListener;
    once: boolean;
    active: boolean;
}

export type ProtocolMode = "raw" | "host" | undefined;

export interface RawProtocolCompat {
    install(): void;
    onInternalMessage(listener: (event: unknown) => void): void;
    forwardEntryEvent(event: unknown, message: Record<string, unknown>): void;
    completeImport(): { mode: ProtocolMode; queuedLifecycleEvents: unknown[] };
    getProtocolMode(): ProtocolMode;
}

export function createRawProtocolCompat(dependencies: {
    parentPort: ParentPort;
    isLifecycleMessage(message: Record<string, unknown>): message is Extract<ServiceParentMessage, { kind: "init" | "probe" | "request" | "shutdown" }>;
    handleHostLifecycle(message: Extract<ServiceParentMessage, { kind: "init" | "probe" | "request" | "shutdown" }>): void;
}): RawProtocolCompat {
    const { parentPort } = dependencies;
    const entryListeners: EntryListener[] = [];
    const queuedLifecycleEvents: unknown[] = [];
    let importSettled = false;
    let rawProtocolDetected = false;
    let protocolMode: ProtocolMode;
    let originalMethods: Record<string, HostRawPortMethod> | undefined;

    function activeEntryListeners(): EntryListener[] {
        return entryListeners.filter((entry: EntryListener): boolean => entry.active);
    }

    function dispatchToEntry(event: unknown): void {
        for (const entry of activeEntryListeners()) {
            if (!entry.active) continue;
            if (entry.once) {
                entry.active = false;
                entryListeners.splice(entryListeners.indexOf(entry), 1);
            }
            try {
                entry.listener.call(parentPort, event);
            } catch (error: unknown) {
                console.error("Raw module service message listener failed:", errMessage(error, "service-error"));
            }
        }
    }

    function addEntryListener(listener: HostMessageListener, once: boolean = false): ParentPort {
        if (typeof listener !== "function") throw new TypeError("The listener must be a function.");
        if (importSettled && protocolMode === "host") {
            console.warn("Ignoring late raw module service message listener; host lifecycle mode is sealed.");
            return parentPort;
        }
        entryListeners.push({ listener, once, active: true });
        rawProtocolDetected = true;
        if (queuedLifecycleEvents.length > 0) {
            for (const event of queuedLifecycleEvents.splice(0)) dispatchToEntry(event);
        }
        return parentPort;
    }

    function removeEntryListener(listener: HostMessageListener): ParentPort {
        const index = entryListeners.map((entry: EntryListener): HostMessageListener => entry.listener).lastIndexOf(listener);
        if (index >= 0) entryListeners.splice(index, 1)[0].active = false;
        return parentPort;
    }

    function removeAllEntryListeners(): ParentPort {
        for (const entry of entryListeners) entry.active = false;
        entryListeners.length = 0;
        return parentPort;
    }

    function listenerFromParentPort(value: unknown): HostMessageListener {
        if (typeof value !== "function") throw new TypeError("The listener must be a function.");
        // ParentPort's runtime EventEmitter callback signature is the raw-protocol boundary.
        return value as HostMessageListener;
    }

    function install(): void {
        if (originalMethods) throw new Error("Raw module service protocol adapter was already installed.");
        // The Electron parent port has runtime EventEmitter methods not represented
        // by the narrow ParentPort declaration. Keep this cast at that boundary.
        const rawParentPort = parentPort as ParentPort & Record<string, HostRawPortMethod>;
        originalMethods = Object.fromEntries(
            ["on", "addListener", "once", "off", "removeListener", "removeAllListeners"]
                .map((name: string): [string, HostRawPortMethod] => [name, rawParentPort[name].bind(parentPort)]),
        );
        const originalPortEventNames = parentPort.eventNames.bind(parentPort);
        const interceptMessageMethod = (name: string, callback: (...args: unknown[]) => ParentPort): HostRawPortMethod => function (eventName: string | symbol, ...args: unknown[]): ParentPort {
            if (eventName !== "message") return originalMethods?.[name](eventName, ...args) ?? parentPort;
            return callback(...args);
        };
        Object.defineProperties(parentPort, {
            on: { configurable: false, value: interceptMessageMethod("on", (listener: unknown): ParentPort => addEntryListener(listenerFromParentPort(listener))) },
            addListener: { configurable: false, value: interceptMessageMethod("addListener", (listener: unknown): ParentPort => addEntryListener(listenerFromParentPort(listener))) },
            once: { configurable: false, value: interceptMessageMethod("once", (listener: unknown): ParentPort => addEntryListener(listenerFromParentPort(listener), true)) },
            off: { configurable: false, value: interceptMessageMethod("off", (listener: unknown): ParentPort => removeEntryListener(listenerFromParentPort(listener))) },
            removeListener: { configurable: false, value: interceptMessageMethod("removeListener", (listener: unknown): ParentPort => removeEntryListener(listenerFromParentPort(listener))) },
            removeAllListeners: { configurable: false, value: function (eventName?: string | symbol): ParentPort {
                if (eventName === undefined) {
                    removeAllEntryListeners();
                    for (const name of originalPortEventNames()) {
                        if (name !== "message") originalMethods?.removeAllListeners(name);
                    }
                    return parentPort;
                }
                if (eventName === "message") return removeAllEntryListeners();
                return originalMethods?.removeAllListeners(eventName) ?? parentPort;
            } },
        });
    }

    return {
        install,
        onInternalMessage(listener): void {
            if (!originalMethods) throw new Error("Raw module service protocol adapter is not installed.");
            originalMethods.on("message", listener);
        },
        forwardEntryEvent(event, message): void {
            if (activeEntryListeners().length > 0) dispatchToEntry(event);
            else if (dependencies.isLifecycleMessage(message) && !importSettled) queuedLifecycleEvents.push(event);
            else if (dependencies.isLifecycleMessage(message) && protocolMode === "host") dependencies.handleHostLifecycle(message);
        },
        completeImport(): { mode: ProtocolMode; queuedLifecycleEvents: unknown[] } {
            importSettled = true;
            protocolMode = rawProtocolDetected ? "raw" : "host";
            return { mode: protocolMode, queuedLifecycleEvents: protocolMode === "host" ? queuedLifecycleEvents.splice(0) : [] };
        },
        getProtocolMode(): ProtocolMode {
            return protocolMode;
        },
    };
}
