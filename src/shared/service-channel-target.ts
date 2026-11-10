/** Where main delivers the renderer end of a service channel. */
export type ServiceChannelTarget =
    | { kind: "board-frame"; boardId: string }
    | { kind: "renderer" };

export interface ServiceChannelDelivery {
    target: ServiceChannelTarget;
    channelId: string;
}

export function isServiceChannelTarget(value: unknown): value is ServiceChannelTarget {
    if (!value || typeof value !== "object") return false;
    const target = value as { kind?: unknown; boardId?: unknown };
    return target.kind === "renderer" || (target.kind === "board-frame" && typeof target.boardId === "string" && target.boardId.length > 0);
}
