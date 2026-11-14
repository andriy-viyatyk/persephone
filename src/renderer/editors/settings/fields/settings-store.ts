import { settingDefault, type AppSettingsKey, type AppSettingsState } from "../../../api/settings-schema";
import { settings } from "../../../api/settings";
import {
    getBoardSetting,
    setBoardSetting,
    subscribeBoardSettings,
    unsetBoardSetting,
} from "../../../api/board-settings/board-settings-bridge";
import type { BoardSettingValue } from "../../../../shared/board/board-settings-declarations";

export interface SettingsStore<V> {
    get(id: string): V | Promise<V>;
    set(id: string, value: V): void | Promise<void>;
    reset?(id: string): void | Promise<void>;
    subscribe(id: string, callback: (value: V) => void): () => void;
}

type AppSettingValue = AppSettingsState["settings"][AppSettingsKey];

export const appSettingsStore: SettingsStore<AppSettingValue> = {
    get: (id) => settings.get(id as AppSettingsKey),
    set: (id, value) => settings.set(id as AppSettingsKey, value as AppSettingValue),
    reset: (id) => settings.set(id as AppSettingsKey, settingDefault(id as AppSettingsKey)),
    subscribe: (id, callback) => settings.watch(id as AppSettingsKey, callback),
};

export function createBoardSettingsStore(boardRoot: string): SettingsStore<BoardSettingValue> {
    return {
        get: (id) => getBoardSetting(boardRoot, id),
        set: (id, value) => setBoardSetting(boardRoot, id, value),
        reset: (id) => unsetBoardSetting(boardRoot, id),
        subscribe: (id, callback) => subscribeBoardSettings(boardRoot, (change) => {
            if (change.id === id) callback(change.value);
        }),
    };
}
