/** JSON scalar persisted by the renderer-owned board settings store. */
export type BoardSettingValue = string | boolean | number;

export type BoardSettingType = "string" | "boolean" | "number" | "enum";

/** A labelled option used by string settings with the `multiselect` format. */
export interface BoardSettingOption {
    value: string;
    label?: string;
}

/** A normalized declaration read from a board manifest. */
export interface BoardSettingDeclaration {
    id: string;
    type: BoardSettingType;
    default: BoardSettingValue;
    options?: readonly (string | BoardSettingOption)[];
    format?: string;
    label?: string;
    description?: string;
}

/** The complete plaintext board-settings.json shape. */
export type BoardSettingsFile = Record<string, Record<string, BoardSettingValue>>;

/** A persisted-key change. `value` is absent when the explicit value was removed. */
export interface BoardSettingsChange {
    namespace: string;
    id: string;
    value?: BoardSettingValue;
}
