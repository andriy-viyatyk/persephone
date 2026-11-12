import { BrowserWindow, MessageChannelMain, type MessagePortMain, type WebContents } from "electron";
import { MAX_SERVICE_CHANNELS_PER_BOARD, MAX_SERVICE_CHANNELS_PER_SERVICE, type ServiceParentMessage } from "../../ipc/module-service-channels";
import type { CapabilityCallerIdentity } from "../../shared/capability-contract";
import { ServiceError, type ServiceRecord } from "./record";
import { errMessage } from "../../shared/utils";
import { isServiceChannelClose, serviceChannelCloseFrame, type ServiceChannel } from "../../shared/service-channel";
import { openElectronServiceChannel } from "../../shared/service-channel-node";
import { deliverConsumerPort, type ChannelDelivery } from "../channel-delivery";

type CloseReason = { code: string; message: string };

interface ChannelBrokerContext {
    createChannel(): { port1: MessagePortMain; port2: MessagePortMain };
    deliverConsumerPort(delivery: ChannelDelivery, channelId: string, port: MessagePortMain): void;
    openElectronChannel(port: MessagePortMain, owner: string, onClose: () => void): ServiceChannel;
    newChannelId(): string;
}

interface DirectDeliveryOptions {
    kind: "direct";
    record: ServiceRecord;
    boardId: string;
    host: WebContents;
    openMessage: unknown;
    info: { page: { boardId: string }; interface?: { id: string; version: number }; caller?: { id: string; name: string } };
    delivery: ChannelDelivery;
    consumerRoot?: string;
    interfaceId?: string;
    version?: number;
    capMessage?: string;
    rejectDestroyedTarget?: boolean;
}

interface RelayDeliveryOptions {
    kind: "relay";
    channelId: string;
    record: ServiceRecord;
    boardId: string;
    consumer: string;
    openMessage: unknown;
    info: { interface: { id: string; version: number }; caller: CapabilityCallerIdentity };
    delivery: ChannelDelivery;
    cleanup(): void;
    setDeliveredClose(close: (reason: CloseReason) => void): void;
}

type DeliveryOptions = DirectDeliveryOptions | RelayDeliveryOptions;

interface CapabilityRelay {
    channelId: string;
    onClose(listener: () => void): () => void;
}

export class ServiceChannelBroker {
    private readonly capabilityChannels = new Map<string, { record: ServiceRecord; consumer: string; close: (reason: CloseReason) => void }>();
    private readonly serviceOwnerClosures = new Map<string, Set<() => void>>();

    constructor(private readonly context: ChannelBrokerContext = {
        createChannel: () => new MessageChannelMain(),
        deliverConsumerPort,
        openElectronChannel: openElectronServiceChannel,
        newChannelId: () => crypto.randomUUID(),
    }) {}

    channelEnded(record: ServiceRecord, channelId: string): void {
        record.channels.delete(channelId);
    }

    private deliver(options: DirectDeliveryOptions): Promise<string>;
    private deliver(options: RelayDeliveryOptions): Promise<CapabilityRelay>;
    private async deliver(options: DeliveryOptions): Promise<string | CapabilityRelay> {
        if (options.kind === "relay") return this.deliverRelay(options);
        const { record, boardId, host, openMessage, info, delivery } = options;
        const process = record.current;
        if (!process || record.state !== "running") throw new ServiceError("service-exited");
        if (options.rejectDestroyedTarget && host.isDestroyed()) throw new ServiceError("service-exited");
        const boardChannels = [...record.channels.values()].filter((owner) => owner.boardId === boardId).length;
        if (boardChannels >= MAX_SERVICE_CHANNELS_PER_BOARD || record.channels.size >= MAX_SERVICE_CHANNELS_PER_SERVICE) {
            throw new ServiceError("service-busy", options.capMessage);
        }
        const channelId = this.context.newChannelId();
        const generation = process.generation;
        const { port1, port2 } = this.context.createChannel();
        record.channels.set(channelId, { boardId, generation, host, ...(options.consumerRoot ? { consumerRoot: options.consumerRoot } : {}),
            ...(options.interfaceId ? { interfaceId: options.interfaceId } : {}), ...(options.version !== undefined ? { version: options.version } : {}) });
        let openPosted = false;
        try {
            process.postMessage({ kind: "channel-open", channelId, boardId, generation, openMessage, info }, [port2]);
            openPosted = true;
            this.context.deliverConsumerPort(delivery, channelId, port1);
        } catch (error) {
            if (openPosted) {
                try { process.postMessage({ kind: "channel-close", channelId, reason: { code: "service-exited", message: "The channel could not be delivered." } } satisfies ServiceParentMessage); } catch { /* service exited */ }
            }
            record.channels.delete(channelId);
            try { port1.close(); } catch { /* transferred or already closed */ }
            try { port2.close(); } catch { /* transferred or already closed */ }
            throw new ServiceError("service-exited", errMessage(error));
        }
        return channelId;
    }

    trackServiceOwner(boardRootKey: string, onClosed: () => void): () => void {
        const closures = this.serviceOwnerClosures.get(boardRootKey) ?? new Set<() => void>();
        closures.add(onClosed);
        this.serviceOwnerClosures.set(boardRootKey, closures);
        return () => {
            closures.delete(onClosed);
            if (closures.size === 0) this.serviceOwnerClosures.delete(boardRootKey);
        };
    }

    openBoardChannel(record: ServiceRecord, target: WebContents, boardId: string, openMessage: unknown): Promise<string> {
        return this.deliver({ kind: "direct", record, boardId, host: target, openMessage,
            info: { page: { boardId } }, delivery: { kind: "board-frame", webContents: target, boardId }, capMessage: "The service has reached its open channel limit." });
    }

    openServiceChannel(record: ServiceRecord, target: WebContents, boardId: string, consumerRoot: string,
        interfaceId: string, version: number, openMessage: unknown, caller: { id: string; name: string }): Promise<string> {
        return this.deliver({ kind: "direct", record, boardId, host: target, openMessage,
            info: { page: { boardId }, interface: { id: interfaceId, version }, caller },
            delivery: { kind: "board-frame", webContents: target, boardId }, consumerRoot, interfaceId, version });
    }

    openHostServiceChannel(record: ServiceRecord, target: WebContents, ownerLabel: string, interfaceId: string,
        version: number, openMessage: unknown): Promise<string> {
        const boardId = `${ownerLabel}:${BrowserWindow.fromWebContents(target)?.id ?? target.id}`;
        return this.deliver({ kind: "direct", record, boardId, host: target, openMessage,
            info: { page: { boardId }, interface: { id: interfaceId, version }, caller: { id: "persephone", name: "Persephone" } },
            delivery: { kind: "renderer", webContents: target }, interfaceId, version, rejectDestroyedTarget: true });
    }

    async openCapabilityChannel(record: ServiceRecord, consumer: string, openMessage: unknown,
        info: RelayDeliveryOptions["info"], signal: AbortSignal, reauthorize: () => void,
        ensureStarted: () => Promise<void>, delivery?: ChannelDelivery): Promise<ServiceChannel | CapabilityRelay> {
        const consumerCount = [...this.capabilityChannels.values()].filter((item) => item.consumer === consumer).length;
        const serviceCount = [...this.capabilityChannels.values()].filter((item) => item.record === record).length;
        if (consumerCount >= MAX_SERVICE_CHANNELS_PER_BOARD || serviceCount + record.channels.size >= MAX_SERVICE_CHANNELS_PER_SERVICE) throw new ServiceError("busy");
        const channelId = this.context.newChannelId();
        let channel: ServiceChannel | undefined;
        let deliveredClose: ((reason: CloseReason) => void) | undefined;
        let cancelStartup: ((error: unknown) => void) | undefined;
        const abort = () => {
            const error = signal.reason ?? new ServiceError("cancelled");
            const reason = { code: (error as { code?: string }).code ?? "cancelled", message: errMessage(error) };
            if (channel) channel.close(reason);
            else if (deliveredClose) deliveredClose(reason);
            else cancelStartup?.(error);
        };
        const cleanup = () => { this.capabilityChannels.delete(channelId); signal.removeEventListener("abort", abort); };
        this.capabilityChannels.set(channelId, { record, consumer, close: (reason) => {
            if (channel) channel.close(reason); else if (deliveredClose) deliveredClose(reason); else cancelStartup?.(new ServiceError(reason.code, reason.message));
        } });
        signal.addEventListener("abort", abort, { once: true });
        try {
            await Promise.race([ensureStarted(), new Promise<never>((_resolve, reject) => { cancelStartup = reject; if (signal.aborted) abort(); })]);
            if (signal.aborted) throw signal.reason;
            reauthorize();
            const process = record.current;
            if (!process || record.state !== "running") throw new ServiceError("handler-closed");
            if (!delivery) {
                const { port1, port2 } = this.context.createChannel();
                channel = this.context.openElectronChannel(port1, "capability", cleanup);
                try {
                    process.postMessage({ kind: "channel-open", channelId, boardId: consumer, generation: process.generation,
                        openMessage, info: { page: { boardId: consumer }, ...info } } satisfies ServiceParentMessage, [port2]);
                } catch (error) { channel.close({ code: "handler-closed", message: "Channel delivery failed." }); port2.close(); throw error; }
                return channel;
            }
            return await this.deliver({ kind: "relay", channelId, record, boardId: consumer, consumer, openMessage, info, delivery,
                cleanup, setDeliveredClose: (close) => { deliveredClose = close; } });
        } catch (error) { cleanup(); throw error; }
    }

    closeChannel(record: ServiceRecord, channelId: string, reason: CloseReason): void {
        if (!record.channels.delete(channelId)) return;
        try { record.current?.postMessage({ kind: "channel-close", channelId, reason } satisfies ServiceParentMessage); } catch { /* exiting */ }
    }

    closeChannelsForProvider(record: ServiceRecord, reason: CloseReason): void {
        for (const channelId of record.channels.keys()) this.closeChannel(record, channelId, reason);
    }

    closeBoardChannels(records: Iterable<ServiceRecord>, boardId: string, reason: CloseReason): void {
        for (const record of records) {
            for (const [channelId, owner] of record.channels) {
                if (owner.boardId === boardId) this.closeChannel(record, channelId, reason);
            }
        }
    }

    closeRecordChannels(record: ServiceRecord, reason: CloseReason): void {
        for (const closeOwner of this.serviceOwnerClosures.get(record.key) ?? []) closeOwner();
        this.serviceOwnerClosures.delete(record.key);
        for (const channel of this.capabilityChannels.values()) {
            if (channel.record === record || channel.consumer === `service:${record.key}`) channel.close(reason);
        }
        for (const [channelId] of record.channels) {
            try { record.current?.postMessage({ kind: "channel-close", channelId, reason } satisfies ServiceParentMessage); } catch { /* exiting */ }
        }
        record.channels.clear();
    }

    private deliverRelay(options: RelayDeliveryOptions): CapabilityRelay {
        const { record, boardId, openMessage, info, delivery, cleanup, channelId } = options;
        const { port1, port2 } = this.context.createChannel();
        const relay = this.context.createChannel();
        const listeners = new Set<() => void>();
        let closed = false;
        const finish = () => {
            if (closed) return;
            closed = true;
            port1.close(); relay.port1.close(); cleanup();
            for (const listener of listeners) listener();
            listeners.clear();
        };
        const deliveredClose = (reason: CloseReason) => {
            try { port1.postMessage(serviceChannelCloseFrame(reason)); } catch { /* Peer exited. */ }
            try { relay.port1.postMessage(serviceChannelCloseFrame(reason)); } catch { /* Peer exited. */ }
            finish();
        };
        options.setDeliveredClose(deliveredClose);
        port1.on("message", ({ data }) => { try { relay.port1.postMessage(data); } catch { finish(); } if (isServiceChannelClose(data)) finish(); });
        relay.port1.on("message", ({ data }) => { try { port1.postMessage(data); } catch { finish(); } if (isServiceChannelClose(data)) finish(); });
        port1.on("close", () => deliveredClose({ code: "handler-closed", message: "Channel disconnected." }));
        relay.port1.on("close", () => deliveredClose({ code: "channel-closed", message: "Channel disconnected." }));
        port1.start(); relay.port1.start();
        try {
            const process = record.current;
            if (!process) throw new ServiceError("handler-closed");
            process.postMessage({ kind: "channel-open", channelId, boardId, generation: process.generation,
                openMessage, info: { page: { boardId }, ...info } } satisfies ServiceParentMessage, [port2]);
            this.context.deliverConsumerPort(delivery, channelId, relay.port2);
        } catch (error) {
            deliveredClose({ code: "handler-closed", message: "Channel delivery failed." });
            port2.close(); relay.port2.close();
            throw error;
        }
        return { channelId, onClose(listener: () => void) { if (closed) listener(); else listeners.add(listener); return () => { listeners.delete(listener); }; } };
    }
}
