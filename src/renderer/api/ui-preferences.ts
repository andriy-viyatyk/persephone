import { api } from "../../ipc/renderer/api";

type UiPreferenceValue = string | number | boolean;
type UiPreferences = Record<string, UiPreferenceValue>;

export interface IUiPreferences {
    readNumber(key: string, min?: number, max?: number): number | undefined;
    readString(key: string): string | undefined;
    readBoolean(key: string): boolean | undefined;
    write(key: string, value: UiPreferenceValue): void;
}

let preferences: UiPreferences = {};

function isUiPreferenceValue(value: unknown): value is UiPreferenceValue {
    return (
        typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
    );
}

function validateSnapshot(value: unknown): UiPreferences {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const snapshot: UiPreferences = {};
    for (const [key, preference] of Object.entries(value)) {
        if (!isUiPreferenceValue(preference)) continue;
        Object.defineProperty(snapshot, key, {
            configurable: true,
            enumerable: true,
            value: preference,
            writable: true,
        });
    }
    return snapshot;
}

export async function load(): Promise<void> {
    try {
        preferences = validateSnapshot(await api.getUiPreferences());
    } catch {
        preferences = {};
    }
}

const readNumber = (key: string, min?: number, max?: number): number | undefined => {
    const value = preferences[key];
    if (typeof value !== "number") return undefined;
    if (min !== undefined && value < min) return min;
    if (max !== undefined && value > max) return max;
    return value;
};

const readString = (key: string): string | undefined => {
    const value = preferences[key];
    return typeof value === "string" ? value : undefined;
};

const readBoolean = (key: string): boolean | undefined => {
    const value = preferences[key];
    return typeof value === "boolean" ? value : undefined;
};

const write = (key: string, value: UiPreferenceValue): void => {
    if (!isUiPreferenceValue(value)) return;

    // Update the cache first: a page opened before the IPC round trip completes
    // still seeds from the value the user just chose.
    preferences[key] = value;

    void api.setUiPreference(key, value).catch(() => {
        // Preference persistence is best-effort and must not disrupt the UI.
    });
};

export const uiPreferences: IUiPreferences = {
    readNumber,
    readString,
    readBoolean,
    write,
};
