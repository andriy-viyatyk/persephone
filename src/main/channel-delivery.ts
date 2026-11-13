import type { ServiceParentMessage } from "../ipc/module-service-channels";
import type { ServiceChannelDelivery, ServiceChannelTarget } from "../shared/service-channel-target";
import type { MessagePortMain, WebContents } from "electron";

export interface ServiceProcessPort {
    postMessage(message: ServiceParentMessage, ports?: MessagePortMain[]): void;
    onExit(listener: () => void): () => void;
}

export type ChannelDelivery =
    | { kind: "board-frame"; webContents: WebContents; boardId: string }
    | { kind: "renderer"; webContents: WebContents }
    | { kind: "service"; process: ServiceProcessPort; requestId: string };

export function deliveryOwner(delivery: ChannelDelivery): WebContents | ServiceProcessPort {
    return delivery.kind === "service" ? delivery.process : delivery.webContents;
}

export function deliverConsumerPort(delivery: ChannelDelivery, channelId: string, port: MessagePortMain): void {
    if (delivery.kind === "service") {
        delivery.process.postMessage({ kind: "capability-client-port", requestId: delivery.requestId } satisfies ServiceParentMessage, [port]);
        return;
    }
    const target: ServiceChannelTarget = delivery.kind === "board-frame" ? { kind: "board-frame", boardId: delivery.boardId } : { kind: "renderer" };
    delivery.webContents.postMessage("eBoardServiceChannel", { target, channelId } satisfies ServiceChannelDelivery, [port]);
}
