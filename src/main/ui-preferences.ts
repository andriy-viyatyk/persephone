import { JsonFileStore } from "./json-file-store";

export type UiPreferenceValue = string | number | boolean;
export type UiPreferences = Record<string, UiPreferenceValue>;

let preferences: UiPreferences | undefined;

function isUiPreferenceValue(value: unknown): value is UiPreferenceValue {
    return (
        typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
    );
}

function filterPreferences(parsed: unknown): UiPreferences | null {
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const loaded: UiPreferences = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!isUiPreferenceValue(value)) continue;
        Object.defineProperty(loaded, key, { configurable: true, enumerable: true, value, writable: true });
    }
    return loaded;
}

const store = new JsonFileStore<UiPreferences>("uiPreferences.json", {
    validate: filterPreferences,
    defaultValue: () => ({}),
    onSaveError: "warn",
});

function getPreferences(): UiPreferences {
    preferences ??= store.loadSync().value;
    return preferences;
}

function savePreferences(): void {
    store.saveSync(getPreferences());
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
