import type { StyledText } from "../../editors/log-view/logTypes";
import { DIALOG_SPECS, getLogEntryType, typesFor, type DialogSpec } from "../../editors/log-view/log-entry-types";

export class UiPushValidationError extends Error {}

export interface NormalizedUiPushEntry {
    readonly type: string;
    readonly fields: StyledText | Record<string, unknown>;
    readonly isDialog: boolean;
}

/** The log levels the guide documents. Anything else under `log.` is a typo, not a level. */
const KNOWN_LOG_TYPES = new Set(typesFor("log"));

/** The rich output entry types the guide documents. */
const KNOWN_OUTPUT_TYPES = new Set(typesFor("output"));

/** Every entry type a caller may legitimately push, for the strict path's error message. */
function knownEntryTypes(): string {
    return [...KNOWN_LOG_TYPES, ...KNOWN_OUTPUT_TYPES, ...Object.keys(DIALOG_SPECS)].join(", ");
}

function formatRawEntry(raw: unknown): string {
    if (raw === null) return "null";
    if (typeof raw !== "object") {
        try {
            return typeof raw === "string" ? JSON.stringify(raw) : String(raw);
        } catch {
            return "<unformattable value>";
        }
    }
    try {
        const serialized = JSON.stringify(raw);
        if (serialized !== undefined) return serialized;
    } catch {
        // Fall through to String for values that JSON cannot serialize.
    }
    try {
        return String(raw);
    } catch {
        return "<unformattable value>";
    }
}

function rawEntryType(raw: unknown): string {
    return raw === null ? "null" : typeof raw;
}

export function invalidUiPushEntryError(raw: unknown): UiPushValidationError {
    const typeDetail = raw && typeof raw === "object" && !Array.isArray(raw)
        ? ` Its \"type\" field must be a string; received ${formatRawEntry((raw as Record<string, unknown>).type)}.`
        : "";
    return new UiPushValidationError(
        `Invalid Log View entry ${formatRawEntry(raw)} (runtime type ${rawEntryType(raw)}).${typeDetail} `
        + "Expected a plain string or flat object with a type. "
        + 'Example: { type: "log.info", text: "done" }',
    );
}

function gridNormalizationError(error: string, fields: Record<string, unknown>, dataType?: string): UiPushValidationError {
    if (error === "grid-content-missing") {
        return new UiPushValidationError(
            `output.grid requires 'content' field (JSON string or CSV string). Example: { type: "output.grid", content: "[{\\"name\\":\\"A\\",\\"value\\":1}]", title: "My Table" }`,
        );
    }
    if (error === "grid-content-not-string") {
        return new UiPushValidationError(
            `output.grid 'content' must be a string (JSON array or CSV text), not ${typeof fields.content}. Stringify your data: content: JSON.stringify(data). Example: { type: "output.grid", content: "[{\\"name\\":\\"A\\",\\"value\\":1}]", contentType: "json", title: "My Table" }`,
        );
    }
    if (error === "grid-invalid-json") {
        return new UiPushValidationError(
            `output.grid 'content' is not valid JSON. Content must be a JSON array string, e.g.: "[{\\"name\\":\\"A\\",\\"value\\":1}]"`,
        );
    }
    return new UiPushValidationError(
        `output.grid 'content' must be a JSON array, got ${dataType}. Example: "[{\\"name\\":\\"A\\",\\"value\\":1}]"`,
    );
}

/**
 * `source: "push"` preserves the strict writer's known-type checks, dialog validation,
 * and grid content parsing. `source: "script"` differs only by skipping unknown-type/schema-type
 * rejection (while keeping the shared `input.*` dialog classification), skipping dialog unknown-property checks plus required checks for confirm,
 * buttons, radioboxes, and select (checkboxes keeps required/array checks), and passing
 * through output.grid array data when content is absent. Type splitting, dialog
 * classification, and output-field copying are shared.
 */
export function normalizeUiPushEntry(
    raw: unknown,
    options: { readonly source: "push" | "script" },
): NormalizedUiPushEntry | undefined {
    const strictTypes = options.source === "push";
    const entry = typeof raw === "string"
        ? { type: "log.info", text: raw }
        : raw && typeof raw === "object" && !Array.isArray(raw)
            ? raw as Record<string, unknown>
            : undefined;
    if (!entry) {
        if (strictTypes) throw invalidUiPushEntryError(raw);
        return undefined;
    }

    const { type, ...fields } = entry;
    if (typeof type !== "string") {
        if (strictTypes) throw invalidUiPushEntryError(raw);
        return undefined;
    }
    if (!type && !strictTypes) return undefined;

    if (strictTypes
        && !KNOWN_LOG_TYPES.has(type)
        && !KNOWN_OUTPUT_TYPES.has(type)
        && !(type in DIALOG_SPECS)) {
        throw new UiPushValidationError(
            `Unknown entry type '${type}'. Valid types: ${knownEntryTypes()}. `
            + `A plain string is shorthand for log.info.`,
        );
    }

    if (type.startsWith("input.")) {
        const spec: DialogSpec | undefined = getLogEntryType(type)?.dialogSpec;
        if (!spec) {
            if (options.source === "script") return { type, fields, isDialog: true };
            const validTypes = Object.keys(DIALOG_SPECS).join(", ");
            throw new UiPushValidationError(
                `Unknown dialog type '${type}'. Valid types: ${validTypes}. Read persephone://guides/ui-push for details.`,
            );
        }
        const unknownProps = strictTypes ? Object.keys(fields).filter((key) => !spec.props.has(key)) : [];
        if (unknownProps.length > 0) {
            throw new UiPushValidationError(
                `Unknown properties for ${type}: ${unknownProps.join(", ")}. Correct usage: ${spec.usage}`,
            );
        }
        const checkScriptRequired = type === "input.checkboxes";
        if (spec.required && (strictTypes || checkScriptRequired) && !fields[spec.required]) {
            const requiredType = spec.required === "items" ? "array" : "string";
            throw new UiPushValidationError(
                `${type} requires '${spec.required}' (${requiredType}). Correct usage: ${spec.usage}`,
            );
        }
        if (spec.required === "items" && (strictTypes || checkScriptRequired) && !Array.isArray(fields.items)) {
            throw new UiPushValidationError(
                `${type} 'items' must be an array. Correct usage: ${spec.usage}`,
            );
        }
        return { type, fields, isDialog: true };
    }

    if (type.startsWith("output.")) {
        const normalization = getLogEntryType(type)?.normalizePush?.(type, fields, options.source)
            ?? { fields: { ...fields } };
        if ("error" in normalization) {
            throw gridNormalizationError(normalization.error, fields, "dataType" in normalization ? normalization.dataType : undefined);
        }
        return { type, fields: normalization.fields, isDialog: false };
    }

    return { type, fields: (fields.text ?? "") as StyledText, isDialog: false };
}
