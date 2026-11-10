export type BoardServiceSettingValue = string | number | boolean;

export const BoardServiceSettingsChannel = {
    changed: "board-service-settings:changed",
} as const;

export interface BoardServiceSettingsChange {
    subscriptionId: string;
    id: string;
    value: BoardServiceSettingValue;
}
