import type { BoardSettingValue } from "../../../shared/board/board-settings-declarations";

/** The complete plaintext board-settings.json shape. */
export type BoardSettingsFile = Record<string, Record<string, BoardSettingValue>>;

/** A persisted-key change. `value` is absent when the explicit value was removed. */
export interface BoardSettingsChange {
    namespace: string;
    id: string;
    value?: BoardSettingValue;
}
