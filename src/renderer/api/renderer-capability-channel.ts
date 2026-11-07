import { serialize } from "node:v8";
import { MAX_SERVICE_CHANNEL_IN_FLIGHT, MAX_SERVICE_CHANNEL_MESSAGE_BYTES } from "../../shared/capability-limits";
import type { CapabilityChannel, CapabilityChannelReason } from "./types/capabilities";

export function createRendererCapabilityChannel(port: MessagePort): CapabilityChannel {
    const messages = new Set<(value: unknown) => void>();
    const closes = new Set<(reason: CapabilityChannelReason) => void>();
    const waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
    let reason: CapabilityChannelReason | undefined;
    let sent = 0, acknowledged = 0, received = 0;
    const finish = (next: CapabilityChannelReason) => {
        if (reason) return;
        reason = next; port.close();
        for (const waiter of waiters) waiter.reject(Object.assign(new Error(next.message), { code: next.code }));
        waiters.clear();
        for (const listener of closes) listener(next);
        closes.clear(); messages.clear();
    };
    port.onmessage = ({ data }) => {
        if (data?.kind === "ack" && Number.isSafeInteger(data.sequence)) {
            acknowledged = Math.max(acknowledged, Math.min(data.sequence, sent));
            for (const waiter of waiters) waiter.resolve();
            waiters.clear();
        } else if (data?.kind === "data" && data.sequence === received + 1) {
            received = data.sequence;
            for (const listener of messages) listener(data.value);
            port.postMessage({ kind: "ack", sequence: received });
        } else if (data?.kind === "close") finish(data.reason ?? { code: "channel-closed", message: "Channel closed." });
    };
    port.onmessageerror = () => finish({ code: "handler-closed", message: "Channel disconnected." });
    port.start();
    return {
        get writable() { return !reason && sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT; },
        send(value) {
            if (reason) throw Object.assign(new Error(reason.message), { code: reason.code });
            if (sent - acknowledged >= MAX_SERVICE_CHANNEL_IN_FLIGHT) throw Object.assign(new Error("Channel send window is full."), { code: "channel-backpressure" });
            let size: number;
            try { size = serialize(value).byteLength; } catch { throw Object.assign(new Error("Channel message is not cloneable."), { code: "rejected" }); }
            if (size > MAX_SERVICE_CHANNEL_MESSAGE_BYTES) throw Object.assign(new Error("Channel message is too large."), { code: "payload-too-large" });
            port.postMessage({ kind: "data", sequence: ++sent, value });
        },
        onMessage(listener) { messages.add(listener); return () => { messages.delete(listener); }; },
        onClose(listener) { if (reason) listener(reason); else closes.add(listener); return () => { closes.delete(listener); }; },
        close(next = { code: "channel-closed", message: "Channel closed." }) {
            if (reason) return;
            try { port.postMessage({ kind: "close", reason: next }); } catch { /* Peer exited. */ }
            finish(next);
        },
        whenWritable() {
            if (reason) return Promise.reject(Object.assign(new Error(reason.message), { code: reason.code }));
            if (sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT) return Promise.resolve();
            return new Promise<void>((resolve, reject) => { waiters.add({ resolve, reject }); });
        },
    };
}
