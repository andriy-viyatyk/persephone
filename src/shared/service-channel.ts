import type { CapabilityErrorCode } from "./capability-constants";
import { codedError } from "./coded-error";
import {
    MAX_SERVICE_CHANNEL_IN_FLIGHT,
    MAX_SERVICE_CHANNEL_MESSAGE_BYTES,
    SERVICE_CHANNEL_ACK_BATCH,
    SERVICE_CHANNEL_ACK_DELAY_MS,
} from "./capability-limits";
import { errMessage } from "./utils";
import type { WireError } from "./wire-error";

// This follows the shared execute-handle boundary pattern.
export const SERVICE_CHANNEL_WIRE_KINDS = ["data", "ack", "close"] as const;
export type ServiceChannelWire =
    | { kind: "data"; sequence: number; value: unknown }
    | { kind: "ack"; sequence: number }
    | { kind: "close"; reason?: WireError };

export function isServiceChannelClose(data: unknown): boolean {
    return typeof data === "object" && data !== null && (data as { kind?: unknown }).kind === "close";
}

export function serviceChannelCloseFrame(reason: WireError): ServiceChannelWire {
    return { kind: "close", reason };
}

export const SERVICE_CHANNEL_CODES = {
    backpressure: "channel-backpressure",
    tooLarge: "payload-too-large",
    notCloneable: "rejected",
    closed: "channel-closed",
} as const satisfies Record<string, CapabilityErrorCode>;

export type ServiceChannelKind = "service" | "capability";
export const SERVICE_CHANNEL_PEER_GONE: Record<ServiceChannelKind, WireError> = {
    service: { code: "service-exited", message: "The channel peer disconnected." },
    capability: { code: "handler-closed", message: "The channel peer disconnected." },
};

export interface ServiceChannel {
    readonly writable: boolean;
    send(value: unknown): void;
    whenWritable(): Promise<void>;
    onMessage(listener: (value: unknown) => void): () => void;
    onClose(listener: (reason: WireError) => void): () => void;
    close(reason?: WireError): void;
}

export interface ChannelPort {
    post(frame: ServiceChannelWire): void;
    start(handlers: { onMessage(data: unknown): void; onInvalid(): void; onClose(): void }): void;
    close(): void;
}

export interface DomPortLike {
    onmessage: ((event: { data: unknown }) => void) | null;
    onmessageerror: ((event: MessageEvent) => unknown) | null;
    addEventListener(type: "close", listener: () => void): void;
    postMessage(message: unknown): void;
    start(): void;
    close(): void;
}

export function domPort(port: DomPortLike): ChannelPort {
    return {
        post: (frame) => port.postMessage(frame),
        start: ({ onMessage, onInvalid, onClose }) => {
            port.onmessage = (event) => onMessage(event.data);
            port.onmessageerror = () => onInvalid();
            port.addEventListener("close", () => onClose());
            port.start();
        },
        close: () => { try { port.close(); } catch { /* already closed */ } },
    };
}

export interface ElectronPortLike {
    on(event: "message", listener: (event: { data: unknown }) => void): unknown;
    on(event: "close", listener: () => void): unknown;
    postMessage(message: unknown): void;
    start(): void;
    close(): void;
}

export function electronPort(port: ElectronPortLike): ChannelPort {
    return {
        post: (frame) => port.postMessage(frame),
        start: ({ onMessage, onClose }) => {
            port.on("message", (event) => onMessage(event.data));
            port.on("close", () => onClose());
            port.start();
        },
        close: () => { try { port.close(); } catch { /* already closed */ } },
    };
}

export interface ServiceChannelOptions {
    kind: ServiceChannelKind;
    measureBytes?: (value: unknown) => number;
    onEnd?: () => void;
}

function isWireReason(value: unknown): value is WireError {
    return typeof value === "object" && value !== null
        && typeof (value as WireError).code === "string" && (value as WireError).code.length > 0
        && typeof (value as WireError).message === "string";
}

export function createServiceChannel(port: ChannelPort, options: ServiceChannelOptions): ServiceChannel {
    const listeners = new Set<(value: unknown) => void>();
    const closeListeners = new Set<(reason: WireError) => void>();
    const waiters = new Set<{ resolve(): void; reject(error: Error): void }>();
    const early: unknown[] = [];
    let ended: WireError | undefined;
    let sent = 0;
    let acknowledged = 0;
    let received = 0;
    let delivered = 0;
    let acknowledgedIncoming = 0;
    let ackQueued = false;

    const end = (reason: WireError): void => {
        if (ended) return;
        ended = reason;
        early.length = 0;
        port.close();
        try { options.onEnd?.(); } catch (error) { console.error(error); }
        for (const waiter of waiters) waiter.reject(codedError(reason.code, reason.message));
        waiters.clear();
        for (const listener of closeListeners) { try { listener(reason); } catch (error) { console.error(error); } }
        closeListeners.clear();
        listeners.clear();
    };
    const flushAck = (): void => {
        ackQueued = false;
        if (ended || delivered <= acknowledgedIncoming) return;
        acknowledgedIncoming = delivered;
        try { port.post({ kind: "ack", sequence: delivered }); } catch { /* peer gone: the close event follows */ }
    };
    const noteDelivered = (): void => {
        delivered++;
        if (delivered - acknowledgedIncoming >= SERVICE_CHANNEL_ACK_BATCH) flushAck();
        else if (!ackQueued) { ackQueued = true; setTimeout(flushAck, SERVICE_CHANNEL_ACK_DELAY_MS); }
    };
    const dispatch = (value: unknown): void => {
        for (const listener of [...listeners]) { try { listener(value); } catch (error) { console.error(error); } }
        noteDelivered();
    };

    port.start({
        onMessage(data) {
            if (!data || typeof data !== "object") return;
            const frame = data as { kind?: unknown; sequence?: unknown; value?: unknown; reason?: unknown };
            if (frame.kind === "ack" && Number.isSafeInteger(frame.sequence)) {
                acknowledged = Math.max(acknowledged, Math.min(frame.sequence as number, sent));
                for (const waiter of waiters) waiter.resolve();
                waiters.clear();
            } else if (frame.kind === "data" && frame.sequence === received + 1) {
                received = frame.sequence as number;
                if (listeners.size === 0) early.push(frame.value); else dispatch(frame.value);
            } else if (frame.kind === "close") {
                end(isWireReason(frame.reason) ? frame.reason : { code: SERVICE_CHANNEL_CODES.closed, message: "Channel closed." });
            }
        },
        onInvalid: () => end({ code: SERVICE_CHANNEL_PEER_GONE[options.kind].code, message: "The channel received an invalid message." }),
        onClose: () => end(SERVICE_CHANNEL_PEER_GONE[options.kind]),
    });

    return {
        get writable() { return !ended && sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT; },
        send(value: unknown) {
            if (ended) throw codedError(ended.code, ended.message);
            if (sent - acknowledged >= MAX_SERVICE_CHANNEL_IN_FLIGHT) throw codedError(SERVICE_CHANNEL_CODES.backpressure, "Channel send window is full.");
            if (options.measureBytes) {
                let bytes: number;
                try { bytes = options.measureBytes(value); }
                catch { throw codedError(SERVICE_CHANNEL_CODES.notCloneable, "Channel message is not cloneable."); }
                if (bytes > MAX_SERVICE_CHANNEL_MESSAGE_BYTES) throw codedError(SERVICE_CHANNEL_CODES.tooLarge, "Channel message is too large.");
            }
            const sequence = sent + 1;
            try { port.post({ kind: "data", sequence, value }); }
            catch (error) { throw codedError(SERVICE_CHANNEL_CODES.notCloneable, errMessage(error, "Channel message is not cloneable.")); }
            sent = sequence;
        },
        whenWritable() {
            if (ended) return Promise.reject(codedError(ended.code, ended.message));
            if (sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT) return Promise.resolve();
            return new Promise<void>((resolve, reject) => { waiters.add({ resolve, reject }); });
        },
        onMessage(listener) {
            if (ended) return () => undefined;
            listeners.add(listener);
            if (early.length) for (const value of early.splice(0)) dispatch(value);
            return () => { listeners.delete(listener); };
        },
        onClose(listener: (reason: WireError) => void) {
            if (ended) { try { listener(ended); } catch (error) { console.error(error); } return () => undefined; }
            closeListeners.add(listener);
            return () => { closeListeners.delete(listener); };
        },
        close(reason = { code: SERVICE_CHANNEL_CODES.closed, message: "Channel closed." }) {
            if (ended) return;
            try { port.post(serviceChannelCloseFrame(reason)); } catch { /* peer gone */ }
            end(reason);
        },
    };
}
