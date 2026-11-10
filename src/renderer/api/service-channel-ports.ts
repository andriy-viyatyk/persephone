import { api } from "../../ipc/renderer/api";
import { SERVICE_CHANNEL_OPEN_TIMEOUT_MS } from "../../ipc/module-service-channels";
import { PendingRequests } from "../../shared/pending-requests";
import type { ServiceChannelTarget } from "../../shared/service-channel-target";

const UNCLAIMED_PORT_TIMEOUT_MS = SERVICE_CHANNEL_OPEN_TIMEOUT_MS;

export interface ClaimOptions {
    timeoutMs: number;
    timeoutError: () => unknown;
    signal?: AbortSignal;
}

class ServiceChannelPorts {
    private readonly waiting = new PendingRequests<MessagePort, undefined, string>({ abortError: (reason) => reason });
    private readonly unclaimed = new Map<string, { port: MessagePort; timer: ReturnType<typeof setTimeout> }>();

    constructor() {
        api.onBoardServiceChannel((target, channelId, port) => this.receive(target, channelId, port));
    }

    claim(channelId: string, options: ClaimOptions): Promise<MessagePort> {
        const parked = this.unclaimed.get(channelId);
        if (parked) {
            this.unclaimed.delete(channelId);
            clearTimeout(parked.timer);
            return Promise.resolve(parked.port);
        }
        if (this.waiting.has(channelId)) return Promise.reject(options.timeoutError());
        return this.waiting.create(options.timeoutMs, options.signal, { id: channelId, timeoutError: options.timeoutError }).promise;
    }

    private receive(target: ServiceChannelTarget, channelId: string, port: MessagePort): void {
        if (target.kind !== "renderer") return;
        if (this.waiting.settle(channelId, port)) return;
        const previous = this.unclaimed.get(channelId);
        if (previous) { clearTimeout(previous.timer); previous.port.close(); }
        this.unclaimed.set(channelId, { port, timer: setTimeout(() => { this.unclaimed.delete(channelId); port.close(); }, UNCLAIMED_PORT_TIMEOUT_MS) });
    }
}

export const serviceChannelPorts = new ServiceChannelPorts();
