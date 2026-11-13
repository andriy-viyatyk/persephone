import { csvToRecords } from "../../core/utils/csv-utils";
import type { StyledText } from "../../editors/log-view/logTypes";

export interface DialogSpec {
    readonly props: ReadonlySet<string>;
    readonly required?: string;
    readonly usage: string;
}

export const DIALOG_SPECS: Readonly<Record<string, DialogSpec>> = {
    "input.confirm": {
        props: new Set(["id", "message", "buttons"]),
        required: "message",
        usage: '{ type: "input.confirm", message: "Continue?", buttons: ["No", "Yes"] }',
    },
    "input.text": {
        props: new Set(["id", "title", "placeholder", "defaultValue", "buttons"]),
        usage: '{ type: "input.text", title: "Enter name", placeholder: "Name...", buttons: ["Cancel", "OK"] }',
    },
    "input.buttons": {
        props: new Set(["id", "title", "buttons"]),
        required: "buttons",
        usage: '{ type: "input.buttons", title: "Choose action", buttons: ["Save", "Discard", "Cancel"] }',
    },
    "input.checkboxes": {
        props: new Set(["id", "title", "items", "layout", "buttons"]),
        required: "items",
        usage: '{ type: "input.checkboxes", title: "Select", items: [{ label: "A", checked: true }, { label: "B" }], buttons: ["Cancel", "OK"] }',
    },
    "input.radioboxes": {
        props: new Set(["id", "title", "items", "checked", "layout", "buttons"]),
        required: "items",
        usage: '{ type: "input.radioboxes", title: "Pick one", items: ["Small", "Medium", "Large"], buttons: ["Cancel", "OK"] }',
    },
    "input.select": {
        props: new Set(["id", "title", "items", "selected", "placeholder", "buttons"]),
        required: "items",
        usage: '{ type: "input.select", title: "Format", items: ["JSON", "CSV", "XML"], placeholder: "Choose...", buttons: ["Cancel", "OK"] }',
    },
};

export class UiPushValidationError extends Error {}

export interface NormalizedUiPushEntry {
    readonly type: string;
    readonly fields: StyledText | Record<string, unknown>;
    readonly isDialog: boolean;
}

/** The log levels the guide documents. Anything else under `log.` is a typo, not a level. */
const KNOWN_LOG_TYPES = new Set(["log.text", "log.info", "log.warn", "log.error", "log.success"]);

/** The rich output entry types the guide documents. */
const KNOWN_OUTPUT_TYPES = new Set([
    "output.text", "output.markdown", "output.mermaid", "output.grid", "output.progress",
]);

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
        const spec = DIALOG_SPECS[type];
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

    if (type === "output.grid") {
        if (options.source === "script" && Array.isArray(fields.data) && !("content" in fields)) {
            return { type, fields, isDialog: false };
        }
        if (!fields.content) {
            throw new UiPushValidationError(
                `output.grid requires 'content' field (JSON string or CSV string). Example: { type: "output.grid", content: "[{\\\"name\\\":\\\"A\\\",\\\"value\\\":1}]", title: "My Table" }`,
            );
        }
        if (typeof fields.content !== "string") {
            throw new UiPushValidationError(
                `output.grid 'content' must be a string (JSON array or CSV text), not ${typeof fields.content}. Stringify your data: content: JSON.stringify(data). Example: { type: "output.grid", content: "[{\\\"name\\\":\\\"A\\\",\\\"value\\\":1}]", contentType: "json", title: "My Table" }`,
            );
        }
        const contentType = fields.contentType ?? "json";
        let data: unknown[];
        if (contentType === "csv") {
            data = csvToRecords(fields.content, true, ",");
        } else {
            try {
                data = JSON.parse(fields.content);
            } catch {
                throw new UiPushValidationError(
                    `output.grid 'content' is not valid JSON. Content must be a JSON array string, e.g.: "[{\\\"name\\\":\\\"A\\\",\\\"value\\\":1}]"`,
                );
            }
            if (!Array.isArray(data)) {
                throw new UiPushValidationError(
                    `output.grid 'content' must be a JSON array, got ${typeof data}. Example: "[{\\\"name\\\":\\\"A\\\",\\\"value\\\":1}]"`,
                );
            }
        }
        const { content: _content, contentType: _contentType, ...rest } = fields;
        return { type, fields: { ...rest, data }, isDialog: false };
    }

    if (type.startsWith("output.")) {
        const outputFields = { ...fields };
        if (!outputFields.text && outputFields.content
            && (type === "output.text" || type === "output.markdown" || type === "output.mermaid")) {
            outputFields.text = outputFields.content;
            delete outputFields.content;
        }
        return { type, fields: outputFields, isDialog: false };
    }

    return { type, fields: (fields.text ?? "") as StyledText, isDialog: false };
}
