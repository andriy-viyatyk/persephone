import fs from "node:fs";
import path from "node:path";
import { getDataFolder, preparePath } from "./utils";

export type UiPreferenceValue = string | number | boolean;
export type UiPreferences = Record<string, UiPreferenceValue>;

const fileName = "uiPreferences.json";
let preferences: UiPreferences | undefined;

function isUiPreferenceValue(value: unknown): value is UiPreferenceValue {
    return (
        typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
    );
}

function loadPreferences(): UiPreferences {
    try {
        const content = fs.readFileSync(path.join(getDataFolder(), fileName), "utf-8");
        const parsed: unknown = JSON.parse(content);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }

        const loaded: UiPreferences = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!isUiPreferenceValue(value)) continue;
            Object.defineProperty(loaded, key, {
                configurable: true,
                enumerable: true,
                value,
                writable: true,
            });
        }
        return loaded;
    } catch {
        return {};
    }
}

function getPreferences(): UiPreferences {
    preferences ??= loadPreferences();
    return preferences;
}

function savePreferences(): void {
    const dataFolder = getDataFolder();
    if (!preparePath(dataFolder)) return;

    try {
        fs.writeFileSync(
            path.join(dataFolder, fileName),
            JSON.stringify(getPreferences(), null, 2),
            "utf-8",
        );
    } catch {
        // Learned layout preferences are non-critical application state.
    }
}

export function getUiPreferences(): UiPreferences {
    return { ...getPreferences() };
}

export function setUiPreference(key: string, value: UiPreferenceValue): UiPreferenceValue {
    if (!isUiPreferenceValue(value)) {
        throw new TypeError("UI preference values must be finite numbers, strings, or booleans.");
    }

    getPreferences()[key] = value;
    savePreferences();
    return value;
}
