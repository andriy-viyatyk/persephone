import {
    MAX_SERVICE_CHANNEL_IN_FLIGHT,
    MAX_SERVICE_CHANNEL_MESSAGE_BYTES,
    SERVICE_CHANNEL_ACK_BATCH,
    SERVICE_CHANNEL_ACK_DELAY_MS,
} from "../../../ipc/module-service-channels";

export interface SpeechServiceChannel {
    readonly writable: boolean;
    send(message: unknown): void;
    onMessage(callback: (message: unknown) => void): () => void;
    onClose(callback: (reason: { code: string; message: string }) => void): () => void;
    close(reason?: { code: string; message: string }): void;
    whenWritable(): Promise<void>;
}

export function createSpeechServiceChannel(port: MessagePort): SpeechServiceChannel {
    const messages = new Set<(message: unknown) => void>();
    const closes = new Set<(reason: { code: string; message: string }) => void>();
    const waiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
    let closed = false;
    let reason = { code: "service-exited", message: "The speech service channel disconnected." };
    let sent = 0;
    let acknowledged = 0;
    let received = 0;
    let ackedReceived = 0;
    let ackQueued = false;
    const finish = (next: { code: string; message: string }): void => {
        if (closed) return;
        closed = true;
        reason = next;
        port.close();
        waiters.forEach((waiter) => waiter.reject(Object.assign(new Error(reason.message), { code: reason.code })));
        waiters.clear();
        closes.forEach((handler) => handler(reason));
        closes.clear();
        messages.clear();
    };
    port.onmessage = ({ data }: MessageEvent<{ kind?: string; sequence?: number; value?: unknown; reason?: { code: string; message: string } }>): void => {
        if (data?.kind === "ack" && Number.isSafeInteger(data.sequence)) {
            acknowledged = Math.max(acknowledged, Math.min(data.sequence!, sent));
            waiters.forEach((waiter) => waiter.resolve());
            waiters.clear();
        } else if (data?.kind === "data" && data.sequence === received + 1) {
            received = data.sequence;
            messages.forEach((handler) => handler(data.value));
            const acknowledge = (): void => {
                if (closed || received <= ackedReceived) return;
                ackedReceived = received;
                port.postMessage({ kind: "ack", sequence: ackedReceived });
            };
            if (received - ackedReceived >= SERVICE_CHANNEL_ACK_BATCH) acknowledge();
            else if (!ackQueued) {
                ackQueued = true;
                setTimeout(() => { ackQueued = false; acknowledge(); }, SERVICE_CHANNEL_ACK_DELAY_MS);
            }
        } else if (data?.kind === "close") finish(data.reason ?? reason);
    };
    port.onmessageerror = (): void => finish({ code: "service-exited", message: "The speech service sent an invalid message." });
    port.start();
    return {
        get writable() { return !closed && sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT; },
        send(message) {
            if (closed) throw Object.assign(new Error(reason.message), { code: reason.code });
            if (sent - acknowledged >= MAX_SERVICE_CHANNEL_IN_FLIGHT) throw Object.assign(new Error("Service channel send window is full."), { code: "channel-backpressure" });
            if (message && typeof message === "object" && "data" in message && (message as { data?: unknown }).data instanceof ArrayBuffer
                && (message as { data: ArrayBuffer }).data.byteLength > MAX_SERVICE_CHANNEL_MESSAGE_BYTES) {
                throw Object.assign(new Error("Service channel message exceeds 1 MiB."), { code: "channel-message-too-large" });
            }
            port.postMessage({ kind: "data", sequence: ++sent, value: message });
        },
        onMessage(handler) { messages.add(handler); return () => messages.delete(handler); },
        onClose(handler) { if (closed) handler(reason); else closes.add(handler); return () => closes.delete(handler); },
        close(next = { code: "channel-closed", message: "The speech channel was closed." }) {
            if (closed) return;
            try { port.postMessage({ kind: "close", reason: next }); } catch { /* disconnected */ }
            finish(next);
        },
        whenWritable() {
            if (closed) return Promise.reject(Object.assign(new Error(reason.message), { code: reason.code }));
            if (sent - acknowledged < MAX_SERVICE_CHANNEL_IN_FLIGHT) return Promise.resolve();
            return new Promise<void>((resolve, reject) => waiters.add({ resolve, reject }));
        },
    };
}
