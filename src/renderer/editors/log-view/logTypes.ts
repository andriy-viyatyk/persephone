// =============================================================================
// Styled Text
// =============================================================================

export interface StyledSegment {
    text: string;
    styles?: Record<string, string | number>;
}

/** Text that can be either a plain string or an array of styled segments. */
export type StyledText = string | StyledSegment[];

// =============================================================================
// Base Entry
// =============================================================================

export interface LogEntry<T = any> {
    type: string;
    id: string;
    data: T;
    timestamp?: number;
}

// =============================================================================
// Log Entries (display-only)
// =============================================================================

// log.text, log.info, log.warn, log.error, log.success
// data: StyledText

export type LogLevel = "log.text" | "log.info" | "log.warn" | "log.error" | "log.success";

export type LogMessageEntry = LogEntry<StyledText> & { type: LogLevel };

// =============================================================================
// Dialog Entries (interactive)
// =============================================================================

/** Common field added to all dialog data after user responds. */
export interface DialogResultFields {
    button?: string;
}

export interface ConfirmDialogData extends DialogResultFields {
    message: StyledText;
    buttons?: string[];
}

export interface TextDialogData extends DialogResultFields {
    title?: StyledText;
    placeholder?: string;
    defaultValue?: string;
    text?: string;
    buttons?: string[];
}

export interface ButtonsDialogData extends DialogResultFields {
    title?: StyledText;
    buttons: string[];
}

export interface CheckboxesDialogData extends DialogResultFields {
    title?: StyledText;
    items: string[];
    buttons?: string[];
}

export interface RadioboxesDialogData extends DialogResultFields {
    title?: StyledText;
    items: string[];
    buttons?: string[];
}

export interface SelectDialogData extends DialogResultFields {
    title?: StyledText;
    items: string[];
    placeholder?: string;
}

export type DialogEntryType =
    | "input.confirm"
    | "input.text"
    | "input.buttons"
    | "input.checkboxes"
    | "input.radioboxes"
    | "input.select";

export type DialogDataMap = {
    "input.confirm": ConfirmDialogData;
    "input.text": TextDialogData;
    "input.buttons": ButtonsDialogData;
    "input.checkboxes": CheckboxesDialogData;
    "input.radioboxes": RadioboxesDialogData;
    "input.select": SelectDialogData;
};

// =============================================================================
// Output Entries (rich display)
// =============================================================================

export interface ProgressOutputData {
    label?: StyledText;
    value: number;
    max?: number;
}

export interface GridOutputData {
    title?: StyledText;
    columns: string[];
    rows: any[][];
}

export interface TextOutputData {
    title?: StyledText;
    text: string;
    language?: string;
}

export interface MarkdownOutputData {
    text: string;
}

export interface MermaidOutputData {
    text: string;
}

export type OutputEntryType =
    | "output.progress"
    | "output.grid"
    | "output.text"
    | "output.markdown"
    | "output.mermaid";

export type OutputDataMap = {
    "output.progress": ProgressOutputData;
    "output.grid": GridOutputData;
    "output.text": TextOutputData;
    "output.markdown": MarkdownOutputData;
    "output.mermaid": MermaidOutputData;
};

// =============================================================================
// Dialog Result
// =============================================================================

/**
 * Dialog result — the full entry.data object after user responds.
 * Always an object; `button` is `undefined` if dialog was canceled.
 */
export type DialogResult = Record<string, any> & DialogResultFields;

// =============================================================================
// Type Guards
// =============================================================================

const LOG_LEVELS = new Set<string>(["log.text", "log.info", "log.warn", "log.error", "log.success"]);
const DIALOG_TYPES = new Set<string>(["input.confirm", "input.text", "input.buttons", "input.checkboxes", "input.radioboxes", "input.select"]);
const OUTPUT_TYPES = new Set<string>(["output.progress", "output.grid", "output.text", "output.markdown", "output.mermaid"]);

export function isLogEntry(entry: LogEntry): entry is LogMessageEntry {
    return LOG_LEVELS.has(entry.type);
}

export function isDialogEntry(entry: LogEntry): boolean {
    return DIALOG_TYPES.has(entry.type);
}

export function isOutputEntry(entry: LogEntry): boolean {
    return OUTPUT_TYPES.has(entry.type);
}

export function isDialogResolved(entry: LogEntry): boolean {
    return isDialogEntry(entry) && entry.data?.button !== undefined;
}
