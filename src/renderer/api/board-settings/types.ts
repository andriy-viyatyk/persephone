import type { BoardSettingValue } from "../../../shared/board/board-settings-declarations";

/** The complete plaintext board-settings.json shape. */
export type BoardSettingsFile = Record<string, Record<string, BoardSettingValue>>;

/** A persisted-key change. `value` is absent when the explicit value was removed. */
export interface BoardSettingsChange {
    namespace: string;
    id: string;
    value?: BoardSettingValue;
}

/** Decode the persisted comma-separated board multiselect value. */
export function decodeMultiSelect(value: string): string[] {
    return value.split(",").map((token) => token.trim()).filter(Boolean);
}

/** Encode an ordered board multiselect selection for persistence. */
export function encodeMultiSelect(values: readonly string[]): string {
    return values.join(",");
}
