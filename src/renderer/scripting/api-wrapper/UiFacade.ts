import type { LogViewEditor } from "../../editors/log-view";
import type { StyledText, LogEntry, CheckboxItem, GridColumn } from "../../editors/log-view/logTypes";
import { normalizeUiPushEntry, type NormalizedUiPushEntry } from "../../api/mcp/ui-push-validation";
import { StyledLogBuilder } from "./StyledTextBuilder";
import {
    createGridHandle,
    createMarkdownHandle,
    createMermaidHandle,
    createProgressHandle,
    createTextHandle,
    type Grid as GridHandleType,
    type Markdown as MarkdownHandleType,
    type Mermaid as MermaidHandleType,
    type Progress as ProgressHandleType,
    type Text as TextHandleType,
} from "./LogEntryHandle";

/** Excludes arrays so StyledText unions retain their positional branch. */
function isOptionsObject<T>(value: T): value is Exclude<Extract<T, object>, readonly unknown[]> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Script facade for the `ui` global, backed by a LogViewEditor. */
export class UiFacade {
    constructor(private readonly editor: LogViewEditor) {}

    private addDialogEntry(type: string, fields: Record<string, unknown>): Promise<LogEntry> {
        const normalized = this.normalizeScriptEntry(type, fields);
        return this.editor.addDialogEntry(normalized.type, normalized.fields as Record<string, unknown>);
    }

    private normalizeScriptEntry(type: string, fields: Record<string, unknown>): NormalizedUiPushEntry {
        const normalized = normalizeUiPushEntry({ type, ...fields }, { source: "script" });
        if (!normalized) throw new Error("Failed to normalize script Log View entry.");
        return normalized;
    }

    // Console forwarding control

    consoleLogPrevented = false;
    consoleWarnPrevented = false;
    consoleErrorPrevented = false;

    preventConsoleLog() { this.consoleLogPrevented = true; }
    preventConsoleWarn() { this.consoleWarnPrevented = true; }
    preventConsoleError() { this.consoleErrorPrevented = true; }

    // Logging returns StyledLogBuilder for optional chaining

    private addLog(type: string, message: StyledText): StyledLogBuilder {
        const entry = this.editor.addEntry(type, message);
        return new StyledLogBuilder(message, (text) => this.editor.updateEntryText(entry.id, text));
    }

    /** Add a console-forwarded entry (used by installConsoleForwarding, not part of public API). */
    addConsoleEntry(type: string, text: string) { this.editor.addEntry(type, text); }

    log(message: StyledText) { return this.addLog("log.log", message); }
    info(message: StyledText) { return this.addLog("log.info", message); }
    warn(message: StyledText) { return this.addLog("log.warn", message); }
    error(message: StyledText) { return this.addLog("log.error", message); }
    success(message: StyledText) { return this.addLog("log.success", message); }
    text(message: StyledText) { return this.addLog("log.text", message); }
    clear() { this.editor.clear(); }

    // Dialogs accept positional or plain options-object forms.

    readonly dialog = {
        confirm: (messageOrOpts: StyledText | { message: StyledText; buttons?: string[] }, buttons?: string[]): Promise<LogEntry> => {
            if (isOptionsObject(messageOrOpts)) {
                return this.addDialogEntry("input.confirm", messageOrOpts);
            }
            return this.addDialogEntry("input.confirm", { message: messageOrOpts, buttons });
        },

        buttons: (buttonsOrOpts: string[] | { buttons: string[]; title?: StyledText }, title?: StyledText): Promise<LogEntry> => {
            if (isOptionsObject(buttonsOrOpts)) {
                return this.addDialogEntry("input.buttons", buttonsOrOpts);
            }
            return this.addDialogEntry("input.buttons", { buttons: buttonsOrOpts, title });
        },

        textInput: (titleOrOpts?: StyledText | { title?: StyledText; placeholder?: string; defaultValue?: string; buttons?: string[] }, options?: { placeholder?: string; defaultValue?: string; buttons?: string[] }): Promise<LogEntry> => {
            if (isOptionsObject(titleOrOpts)) {
                return this.addDialogEntry("input.text", titleOrOpts);
            }
            return this.addDialogEntry("input.text", { title: titleOrOpts, ...options });
        },

        checkboxes: (itemsOrOpts: (string | CheckboxItem)[] | { items: (string | CheckboxItem)[]; title?: StyledText; layout?: "vertical" | "flex"; buttons?: string[] }, title?: StyledText, buttons?: string[]): Promise<LogEntry> => {
            const normalizeItems = (items: (string | CheckboxItem)[]): CheckboxItem[] =>
                items.map((item) => typeof item === "string" ? { label: item } : item);

            if (Array.isArray(itemsOrOpts)) {
                return this.addDialogEntry("input.checkboxes", { items: normalizeItems(itemsOrOpts), title, buttons });
            }
            return this.addDialogEntry("input.checkboxes", { ...itemsOrOpts, items: normalizeItems(itemsOrOpts.items) });
        },

        radioboxes: (itemsOrOpts: string[] | { items: string[]; title?: StyledText; checked?: string; layout?: "vertical" | "flex"; buttons?: string[] }, title?: StyledText, buttons?: string[]): Promise<LogEntry> => {
            if (Array.isArray(itemsOrOpts)) {
                return this.addDialogEntry("input.radioboxes", { items: itemsOrOpts, title, buttons });
            }
            return this.addDialogEntry("input.radioboxes", itemsOrOpts);
        },

        select: (itemsOrOpts: string[] | { items: string[]; title?: StyledText; selected?: string; placeholder?: string; buttons?: string[] }, title?: StyledText, buttons?: string[]): Promise<LogEntry> => {
            if (Array.isArray(itemsOrOpts)) {
                return this.addDialogEntry("input.select", { items: itemsOrOpts, title, buttons });
            }
            return this.addDialogEntry("input.select", itemsOrOpts);
        },
    };

    // Rich output

    readonly show = {
        progress: (labelOrOpts?: StyledText | { label?: StyledText; value?: number; max?: number }): ProgressHandleType => {
            const fields = isOptionsObject(labelOrOpts) ? labelOrOpts : { label: labelOrOpts };
            const normalized = this.normalizeScriptEntry("output.progress", fields);
            const entry = this.editor.addEntry(normalized.type, normalized.fields);
            return createProgressHandle(entry.id, this.editor, fields);
        },

        grid: (dataOrOpts: unknown[] | { data: unknown[]; columns?: (string | GridColumn)[]; title?: StyledText }): GridHandleType => {
            const fields = Array.isArray(dataOrOpts) ? { data: dataOrOpts } : dataOrOpts;
            const normalized = this.normalizeScriptEntry("output.grid", fields);
            const entry = this.editor.addEntry(normalized.type, normalized.fields);
            return createGridHandle(entry.id, this.editor, fields);
        },

        text: (textOrOpts: string | { text: string; language?: string; title?: StyledText; wordWrap?: boolean; lineNumbers?: boolean; minimap?: boolean }, language?: string): TextHandleType => {
            const fields = isOptionsObject(textOrOpts) ? textOrOpts : { text: textOrOpts, language };
            const normalized = this.normalizeScriptEntry("output.text", fields);
            const entry = this.editor.addEntry(normalized.type, normalized.fields);
            return createTextHandle(entry.id, this.editor, fields);
        },

        markdown: (textOrOpts: string | { text: string; title?: StyledText }): MarkdownHandleType => {
            const fields = isOptionsObject(textOrOpts) ? textOrOpts : { text: textOrOpts };
            const normalized = this.normalizeScriptEntry("output.markdown", fields);
            const entry = this.editor.addEntry(normalized.type, normalized.fields);
            return createMarkdownHandle(entry.id, this.editor, fields);
        },

        mermaid: (textOrOpts: string | { text: string; title?: StyledText }): MermaidHandleType => {
            const fields = isOptionsObject(textOrOpts) ? textOrOpts : { text: textOrOpts };
            const normalized = this.normalizeScriptEntry("output.mermaid", fields);
            const entry = this.editor.addEntry(normalized.type, normalized.fields);
            return createMermaidHandle(entry.id, this.editor, fields);
        },
    };
}
