import type { ServiceErrorPayload } from "./module-service-channels";

export type BoardServiceSettingValue = string | number | boolean;

export const BoardServiceSettingsChannel = {
    get: "board-service-settings:get",
    getReply: "board-service-settings:get-reply",
    subscribe: "board-service-settings:subscribe",
    subscribeReply: "board-service-settings:subscribe-reply",
    unsubscribe: "board-service-settings:unsubscribe",
    unsubscribeReply: "board-service-settings:unsubscribe-reply",
    changed: "board-service-settings:changed",
} as const;

export interface BoardServiceSettingsReply {
    requestId: string;
    ok: boolean;
    result?: BoardServiceSettingValue;
    error?: ServiceErrorPayload;
}

export interface BoardServiceSettingsRequest {
    requestId: string;
    boardRoot: string;
    subscriptionId?: string;
    id?: string;
}

export interface BoardServiceSettingsChange {
    subscriptionId: string;
    id: string;
    value: BoardServiceSettingValue;
}
