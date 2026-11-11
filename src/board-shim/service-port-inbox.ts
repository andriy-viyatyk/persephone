import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../ipc/module-service-channels";

interface ChannelPortWaiter {
    readonly resolve: (port: MessagePort) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

const SERVICE_TIMEOUT_MESSAGE = "The service channel did not reach this board page.";
const DISPOSED_MESSAGE = "The board page closed before the channel opened.";

/** Buffers service ports delivered by the host frame until their feature consumer is ready. */
export class ServicePortInbox {
    private readonly waiters = new Map<string, ChannelPortWaiter>();
    private readonly earlyPorts = new Map<string, MessagePort>();
    private disposed = false;

    receive(channelId: string, port: MessagePort): void {
        if (this.disposed) {
            closePort(port);
            return;
        }
        const waiter = this.waiters.get(channelId);
        if (waiter) {
            this.waiters.delete(channelId);
            clearTimeout(waiter.timer);
            waiter.resolve(port);
        } else {
            this.earlyPorts.set(channelId, port);
        }
    }

    wait(channelId: string): Promise<MessagePort> {
        if (this.disposed) return Promise.reject(new Error(DISPOSED_MESSAGE));
        const earlyPort = this.earlyPorts.get(channelId);
        if (earlyPort) {
            this.earlyPorts.delete(channelId);
            return Promise.resolve(earlyPort);
        }
        return new Promise<MessagePort>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!this.waiters.delete(channelId)) return;
                reject(Object.assign(new Error(SERVICE_TIMEOUT_MESSAGE), { code: "service-timeout" }));
            }, SERVICE_CHANNEL_OPEN_TIMEOUT_MS);
            this.waiters.set(channelId, { resolve, reject, timer });
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        const error = new Error(DISPOSED_MESSAGE);
        for (const [channelId, waiter] of this.waiters) {
            clearTimeout(waiter.timer);
            this.waiters.delete(channelId);
            waiter.reject(error);
        }
        for (const port of this.earlyPorts.values()) closePort(port);
        this.earlyPorts.clear();
    }
}

function closePort(port: MessagePort): void {
    try { port.close(); }
    catch (error: unknown) { console.error("Service port close failed:", error); }
}
