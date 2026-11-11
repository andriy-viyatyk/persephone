import { isBoardSettingValue } from "../shared/board/board-settings-declarations";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { Listeners } from "./primitives";

export function createSettingsApi(deps: { hostFrame: HostFrameChannel }) {
    const { hostFrame } = deps;
    const settingsChangeListeners = new Listeners<[{ id: string; value: string | number | boolean }]>("persephone.settings.onChange callback error:");
    hostFrame.on("settings.changed", (data) => {
        if (typeof data.id !== "string" || data.id.trim().length === 0 || !isBoardSettingValue(data.value)) return;
        settingsChangeListeners.emit({ id: data.id, value: data.value });
    });
    return {
        api: {
            settings: {
                get(id: string): Promise<string | number | boolean> {
                    return hostFrame.request("settings.get", { id }).then((value) => {
                        if (isBoardSettingValue(value)) return value;
                        throw new Error("Malformed persephone.settings.get() response.");
                    });
                },
                onChange(callback: (change: { id: string; value: string | number | boolean }) => void): () => void {
                    return settingsChangeListeners.add(callback);
                },
            },
        },
    };
}
