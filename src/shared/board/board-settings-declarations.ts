import { missingBoardIdentityFields } from "./board-stable-identity";
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

export type BoardSettingsIssueReporter = (name: string, reason: string) => void;

interface RawBoardSetting {
    id?: unknown;
    type?: unknown;
    default?: unknown;
    options?: unknown;
    format?: unknown;
    label?: unknown;
    description?: unknown;
}

export function isBoardSettingValue(value: unknown): value is BoardSettingValue {
    return typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

function isBoardSettingType(value: unknown): value is BoardSettingType {
    return value === "string" || value === "boolean" || value === "number" || value === "enum";
}

function normalizeBoardSettingDeclaration(
    raw: unknown,
    index: number,
    report?: BoardSettingsIssueReporter,
): BoardSettingDeclaration | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        report?.(`entry ${index + 1}`, "The setting declaration must be an object.");
        return undefined;
    }

    const candidate = raw as RawBoardSetting;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!id) {
        report?.(`entry ${index + 1}`, "The setting declaration requires a non-empty id.");
        return undefined;
    }
    if (!isBoardSettingType(candidate.type)) {
        report?.(id, "The setting declaration has an unsupported type.");
        return undefined;
    }
    if (!isBoardSettingValue(candidate.default)) {
        report?.(id, "The setting declaration requires a finite scalar default.");
        return undefined;
    }

    const format = typeof candidate.format === "string" && candidate.format.trim()
        ? candidate.format.trim()
        : undefined;
    const isMultiSelect = format === "multiselect";
    if (isMultiSelect && candidate.type !== "string") {
        report?.(id, "The multiselect format is only valid for string settings.");
        return undefined;
    }

    const options: (string | BoardSettingOption)[] = [];
    if (isMultiSelect) {
        if (!Array.isArray(candidate.options) || candidate.options.length === 0) {
            report?.(id, "Multiselect settings require at least one valid option.");
            return undefined;
        }
        const seenValues = new Set<string>();
        for (const option of candidate.options) {
            let value: string;
            let label: string | undefined;
            if (typeof option === "string") {
                value = option.trim();
            } else if (option && typeof option === "object" && !Array.isArray(option)) {
                const rawOption = option as { value?: unknown; label?: unknown };
                if (typeof rawOption.value !== "string"
                    || (rawOption.label !== undefined && typeof rawOption.label !== "string")) {
                    report?.(id, "Multiselect options must be strings or objects with string values and labels.");
                    return undefined;
                }
                value = rawOption.value.trim();
                label = typeof rawOption.label === "string" ? rawOption.label.trim() : undefined;
                if (rawOption.label !== undefined && !label) {
                    report?.(id, "Multiselect option labels must not be empty.");
                    return undefined;
                }
            } else {
                report?.(id, "Multiselect options must be strings or objects with string values and labels.");
                return undefined;
            }
            if (!value) {
                report?.(id, "Multiselect option values must not be empty.");
                return undefined;
            }
            if (seenValues.has(value)) {
                report?.(id, "Multiselect option values must be unique after trimming.");
                return undefined;
            }
            seenValues.add(value);
            options.push(typeof option === "string" ? value : { value, ...(label ? { label } : {}) });
        }
    } else if (Array.isArray(candidate.options)) {
        for (const option of candidate.options) {
            if (typeof option !== "string") continue;
            const normalizedOption = option.trim();
            if (normalizedOption && !options.includes(normalizedOption)) options.push(normalizedOption);
        }
    }

    const declaration: BoardSettingDeclaration = {
        id,
        type: candidate.type,
        default: candidate.default,
        ...(options.length > 0 ? { options } : {}),
        ...(format ? { format } : {}),
        ...(typeof candidate.label === "string" && candidate.label.trim()
            ? { label: candidate.label.trim() }
            : {}),
        ...(typeof candidate.description === "string" && candidate.description.trim()
            ? { description: candidate.description.trim() }
            : {}),
    };

    if (declaration.type === "enum") {
        if (!declaration.options || declaration.options.length === 0) {
            report?.(id, "Enum settings require non-empty string options.");
            return undefined;
        }
        if (typeof declaration.default !== "string"
            || !declaration.options.some((option) => typeof option === "string" && option === declaration.default)) {
            report?.(id, "The enum default must be one of its options.");
            return undefined;
        }
        return declaration;
    }

    if (isMultiSelect) {
        if (typeof declaration.default !== "string") {
            report?.(id, "The default does not match the declared string type.");
            return undefined;
        }
        const optionValues = new Set(options.map((option) => typeof option === "string" ? option : option.value));
        if (options.length === 0) {
            report?.(id, "Multiselect settings require at least one valid option.");
            return undefined;
        }
        const defaultTokens = declaration.default.split(",").map((token) => token.trim());
        if (defaultTokens.some((token) => token && !optionValues.has(token))) {
            report?.(id, "Every non-empty multiselect default token must match one of its options.");
            return undefined;
        }
        return declaration;
    }

    const matchesType = declaration.type === "string"
        ? typeof declaration.default === "string"
        : declaration.type === "boolean"
          ? typeof declaration.default === "boolean"
          : typeof declaration.default === "number" && Number.isFinite(declaration.default);
    if (!matchesType) {
        report?.(id, `The default does not match the declared ${declaration.type} type.`);
        return undefined;
    }
    return declaration;
}

/** Normalize user-facing board settings without trusting raw manifest data or throwing. */
export function normalizeBoardSettings(
    manifest: unknown,
    report?: BoardSettingsIssueReporter,
): BoardSettingDeclaration[] {
    const candidate = manifest && typeof manifest === "object" && !Array.isArray(manifest)
        ? manifest as { author?: unknown; name?: unknown; settings?: unknown }
        : undefined;
    if (!candidate || !Object.prototype.hasOwnProperty.call(candidate, "settings")) return [];
    const missing = missingBoardIdentityFields(candidate);
    if (missing.length > 0) {
        report?.("identity", boardSettingsIdentityMessage(missing));
        return [];
    }
    if (!Array.isArray(candidate.settings)) {
        report?.("settings", "The settings manifest field must be an array.");
        return [];
    }

    const declarations: BoardSettingDeclaration[] = [];
    const seen = new Set<string>();
    candidate.settings.forEach((raw, index) => {
        const declaration = normalizeBoardSettingDeclaration(raw, index, report);
        if (!declaration || seen.has(declaration.id)) return;
        seen.add(declaration.id);
        declarations.push(declaration);
    });
    return declarations;
}

export function boardSettingsIdentityMessage(missing: readonly string[]): string {
    return `Board settings require a stable board identity; missing ${missing.join(" and ")}.`;
}
