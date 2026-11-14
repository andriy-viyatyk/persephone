import { csvToRecords } from "../../core/utils/csv-utils";
import type { LogEntry, LogMessageEntry } from "./logTypes";

export interface DialogSpec {
    readonly props: ReadonlySet<string>;
    readonly required?: string;
    readonly usage: string;
}

export type LogEntryCategory = "log" | "dialog" | "output";
export type UiPushSource = "push" | "script";

export type PushNormalizationResult =
    | { readonly fields: Record<string, unknown> }
    | { readonly error: "grid-content-missing" | "grid-content-not-string" | "grid-invalid-json" }
    | { readonly error: "grid-json-not-array"; readonly dataType: string };

export interface LogEntryTypeDefinition {
    readonly category: LogEntryCategory;
    readonly agentDocumented: boolean;
    readonly dialogSpec?: DialogSpec;
    readonly normalizePush?: (type: string, fields: Record<string, unknown>, source: UiPushSource) => PushNormalizationResult;
}

const dialogSpec = (props: string[], usage: string, required?: string): DialogSpec => ({
    props: new Set(props),
    ...(required ? { required } : {}),
    usage,
});

function normalizeTextOutput(type: string, fields: Record<string, unknown>, _source: UiPushSource): PushNormalizationResult {
    const outputFields = { ...fields };
    if (!outputFields.text && outputFields.content
        && (type === "output.text" || type === "output.markdown" || type === "output.mermaid")) {
        outputFields.text = outputFields.content;
        delete outputFields.content;
    }
    return { fields: outputFields };
}

function normalizeGridOutput(_type: string, fields: Record<string, unknown>, source: UiPushSource): PushNormalizationResult {
    if (source === "script" && Array.isArray(fields.data) && !("content" in fields)) {
        return { fields };
    }
    if (!fields.content) return { error: "grid-content-missing" };
    if (typeof fields.content !== "string") return { error: "grid-content-not-string" };

    const contentType = fields.contentType ?? "json";
    let data: unknown[];
    if (contentType === "csv") {
        data = csvToRecords(fields.content, true, ",");
    } else {
        try {
            data = JSON.parse(fields.content);
        } catch {
            return { error: "grid-invalid-json" };
        }
        if (!Array.isArray(data)) return { error: "grid-json-not-array", dataType: typeof data };
    }
    const { content: _content, contentType: _contentType, ...rest } = fields;
    return { fields: { ...rest, data } };
}

/** DOM-free catalog for Log View entry classification and caller normalization. */
export const LOG_ENTRY_TYPES: ReadonlyMap<string, LogEntryTypeDefinition> = new Map([
    ["log.log", { category: "log", agentDocumented: false }],
    ["log.text", { category: "log", agentDocumented: true }],
    ["log.info", { category: "log", agentDocumented: true }],
    ["log.warn", { category: "log", agentDocumented: true }],
    ["log.error", { category: "log", agentDocumented: true }],
    ["log.success", { category: "log", agentDocumented: true }],
    ["input.confirm", {
        category: "dialog", agentDocumented: true,
        dialogSpec: dialogSpec(["id", "message", "buttons"], '{ type: "input.confirm", message: "Continue?", buttons: ["No", "Yes"] }', "message"),
    }],
    ["input.text", {
        category: "dialog", agentDocumented: true,
        dialogSpec: dialogSpec(["id", "title", "placeholder", "defaultValue", "buttons"], '{ type: "input.text", title: "Enter name", placeholder: "Name...", buttons: ["Cancel", "OK"] }'),
    }],
    ["input.buttons", {
        category: "dialog", agentDocumented: true,
        dialogSpec: dialogSpec(["id", "title", "buttons"], '{ type: "input.buttons", title: "Choose action", buttons: ["Save", "Discard", "Cancel"] }', "buttons"),
    }],
    ["input.checkboxes", {
        category: "dialog", agentDocumented: true,
        dialogSpec: dialogSpec(["id", "title", "items", "layout", "buttons"], '{ type: "input.checkboxes", title: "Select", items: [{ label: "A", checked: true }, { label: "B" }], buttons: ["Cancel", "OK"] }', "items"),
    }],
    ["input.radioboxes", {
        category: "dialog", agentDocumented: true,
        dialogSpec: dialogSpec(["id", "title", "items", "checked", "layout", "buttons"], '{ type: "input.radioboxes", title: "Pick one", items: ["Small", "Medium", "Large"], buttons: ["Cancel", "OK"] }', "items"),
    }],
    ["input.select", {
        category: "dialog", agentDocumented: true,
        dialogSpec: dialogSpec(["id", "title", "items", "selected", "placeholder", "buttons"], '{ type: "input.select", title: "Format", items: ["JSON", "CSV", "XML"], placeholder: "Choose...", buttons: ["Cancel", "OK"] }', "items"),
    }],
    ["output.text", { category: "output", agentDocumented: true, normalizePush: normalizeTextOutput }],
    ["output.markdown", { category: "output", agentDocumented: true, normalizePush: normalizeTextOutput }],
    ["output.mermaid", { category: "output", agentDocumented: true, normalizePush: normalizeTextOutput }],
    ["output.grid", { category: "output", agentDocumented: true, normalizePush: normalizeGridOutput }],
    ["output.progress", { category: "output", agentDocumented: true }],
    ["output.mcp-request", { category: "output", agentDocumented: false }],
]);

export function getLogEntryType(type: string): LogEntryTypeDefinition | undefined {
    return LOG_ENTRY_TYPES.get(type);
}

export function typesFor(category: LogEntryCategory): string[] {
    return [...LOG_ENTRY_TYPES]
        .filter(([, definition]) => definition.category === category && definition.agentDocumented)
        .map(([type]) => type);
}

/** Kept as an ordinary object because strict push validation intentionally uses `in`. */
export const DIALOG_SPECS: Readonly<Record<string, DialogSpec>> = Object.fromEntries(
    [...LOG_ENTRY_TYPES]
        .filter(([, definition]) => definition.dialogSpec)
        .map(([type, definition]) => [type, definition.dialogSpec!]),
);

export const isLogEntry = (entry: LogEntry): entry is LogMessageEntry => getLogEntryType(entry.type)?.category === "log";
export const isDialogEntry = (entry: LogEntry): boolean => getLogEntryType(entry.type)?.category === "dialog";
export const isOutputEntry = (entry: LogEntry): boolean => getLogEntryType(entry.type)?.category === "output";
export const isDialogResolved = (entry: LogEntry): boolean => isDialogEntry(entry) && entry.button !== undefined;
