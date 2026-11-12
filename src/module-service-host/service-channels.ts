import type { MessagePortMain } from "electron";
import type { ServiceParentMessage } from "../ipc/module-service-channels";
import { openElectronServiceChannel } from "../shared/service-channel-node";
import type { ServiceChannel } from "../shared/service-channel";

export type ServiceChannelHandler = (channel: ServiceChannel, openMessage: unknown, info: unknown) => unknown | Promise<unknown>;

export interface ServiceChannelManager {
    setHandler(handler: ServiceChannelHandler): void;
    make(channelId: string, port: MessagePortMain, kind?: "service" | "capability"): ServiceChannel;
    open(message: Extract<ServiceParentMessage, { kind: "channel-open" }>, port: MessagePortMain | undefined): void;
    close(channelId: string, reason: Parameters<ServiceChannel["close"]>[0]): void;
    closeAll(reason: Parameters<ServiceChannel["close"]>[0]): void;
}

export function createServiceChannels(dependencies: {
    post(message: { kind: "channel-ended"; channelId: string }): void;
    serviceError(error: unknown): { code: string; message: string };
}): ServiceChannelManager {
    const channels = new Map<string, ServiceChannel>();
    let handler: ServiceChannelHandler | undefined;

    function make(channelId: string, port: MessagePortMain, kind: "service" | "capability" = "service"): ServiceChannel {
        const channel = openElectronServiceChannel(port, kind, (): void => {
            channels.delete(channelId);
            try { dependencies.post({ kind: "channel-ended", channelId }); } catch { /* exiting */ }
        });
        channels.set(channelId, channel);
        return channel;
    }

    return {
        setHandler(value): void {
            if (handler) throw new Error("A service channel handler is already registered.");
            handler = value;
        },
        make,
        open(message, port): void {
            if (!port || typeof message.channelId !== "string") return;
            const channel = make(message.channelId, port);
            if (typeof handler !== "function") {
                channel.close({ code: "service-handler-not-registered", message: "The service entry did not register onChannel()." });
                return;
            }
            Promise.resolve().then((): unknown => handler?.(channel, message.openMessage, message.info))
                .catch((error: unknown): void => channel.close(dependencies.serviceError(error)));
        },
        close(channelId, reason): void {
            channels.get(channelId)?.close(reason);
        },
        closeAll(reason): void {
            for (const channel of [...channels.values()]) channel.close(reason);
        },
    };
}
