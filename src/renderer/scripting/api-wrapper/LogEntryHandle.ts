import { app } from "../../api/app";
import type { LogViewEditor } from "../../editors/log-view";
import type {
    GridOutputEntry,
    MarkdownOutputEntry,
    MermaidOutputEntry,
    ProgressOutputEntry,
    StyledText,
    TextOutputEntry,
} from "../../editors/log-view/logTypes";
import { guard } from "../../core/utils/guard";

interface LogEntryFieldBinding<TEntry> {
    readonly property: keyof TEntry & string;
    readonly backingSlot: string;
}

export interface LogEntryOpenConfig {
    readonly capability: "content.view" | "text.open";
    readonly representation?: string;
    readonly content: (handle: LogEntryHandle<object>) => unknown;
    readonly language?: string | ((handle: LogEntryHandle<object>) => string);
    readonly titleField: string;
    readonly defaultTitle: string;
    readonly failureLabel: string;
}

interface ProgressCompletionConfig {
    readonly completedField: "completed";
    readonly labelField: "label";
}

export interface LogEntryHandleConfig<TEntry extends object> {
    readonly fields: readonly LogEntryFieldBinding<TEntry>[];
    readonly open?: LogEntryOpenConfig;
    readonly completion?: ProgressCompletionConfig;
}

type HandleFields<TEntry extends object, TConfig extends LogEntryHandleConfig<TEntry>> = {
    [TBinding in TConfig["fields"][number] as TBinding["property"]]: TEntry[TBinding["property"]];
};

type OpenInEditor = { openInEditor(pageTitle?: string): void };
type CompleteWithPromise = { completeWithPromise(promise: Promise<unknown>, completeLabel?: StyledText): void };
interface RuntimeHandleConfig {
    readonly fields: readonly { readonly property: string; readonly backingSlot: string }[];
}
const handleConfigs = new WeakMap<object, RuntimeHandleConfig>();

/** Shared runtime for script-visible rich Log View output handles. */
export class LogEntryHandle<TEntry extends object> {
    private declare readonly entryId: string;
    private declare readonly vm: LogViewEditor;

    constructor(
        entryId: string,
        vm: LogViewEditor,
        initial: Record<string, unknown>,
        config: LogEntryHandleConfig<TEntry>,
    ) {
        handleConfigs.set(this, config);
        for (const binding of config.fields) {
            Object.defineProperty(this, binding.backingSlot, {
                value: initial[binding.property],
                writable: true,
                enumerable: true,
                configurable: true,
            });
        }
        Object.defineProperty(this, "entryId", { value: entryId, writable: true, enumerable: true, configurable: true });
        Object.defineProperty(this, "vm", { value: vm, writable: true, enumerable: true, configurable: true });
    }

    private update(property: string, value: unknown): void {
        const config = handleConfigs.get(this);
        const binding = config?.fields.find((field) => field.property === property);
        if (!binding) return;
        (this as unknown as Record<string, unknown>)[binding.backingSlot] = value;
        this.vm.updateEntryById(this.entryId, (draft) => {
            const entry = draft as unknown as Record<string, unknown>;
            for (const field of config.fields) {
                entry[field.property] = (this as unknown as Record<string, unknown>)[field.backingSlot];
            }
        });
    }
}

function createHandleClass<TEntry extends object, TConfig extends LogEntryHandleConfig<TEntry>>(
    config: TConfig,
): new (entryId: string, vm: LogViewEditor, initial: Record<string, unknown>) =>
        LogEntryHandle<TEntry> & HandleFields<TEntry, TConfig> & (TConfig["open"] extends LogEntryOpenConfig ? OpenInEditor : {}) &
        (TConfig["completion"] extends ProgressCompletionConfig ? CompleteWithPromise : {}) {
    class ConfiguredLogEntryHandle extends LogEntryHandle<TEntry> {
        constructor(entryId: string, vm: LogViewEditor, initial: Record<string, unknown>) {
            super(entryId, vm, initial, config);
        }
    }

    for (const binding of config.fields) {
        Object.defineProperty(ConfiguredLogEntryHandle.prototype, binding.property, {
            get(this: LogEntryHandle<TEntry>) {
                return (this as unknown as Record<string, unknown>)[binding.backingSlot];
            },
            set(this: LogEntryHandle<TEntry>, value: unknown) {
                (this as unknown as { update(property: string, value: unknown): void }).update(binding.property, value);
            },
            enumerable: false,
            configurable: true,
        });
    }

    const openConfig = config.open;
    if (openConfig) {
        Object.defineProperty(ConfiguredLogEntryHandle.prototype, "openInEditor", {
            value(this: LogEntryHandle<TEntry>, pageTitle?: string) {
                const handle = this as unknown as LogEntryHandle<object> & Record<string, unknown>;
                const titleValue = handle[openConfig.titleField];
                const title = pageTitle ?? (typeof titleValue === "string" ? titleValue : openConfig.defaultTitle);
                const language = typeof openConfig.language === "function" ? openConfig.language(handle) : openConfig.language;
                void guard(openConfig.failureLabel, () => app.capabilities.invoke(openConfig.capability, {
                    ...(openConfig.representation ? { representation: openConfig.representation } : {}),
                    content: openConfig.content(handle),
                    ...(language ? { language } : {}),
                    title,
                }));
            },
            enumerable: false,
            configurable: true,
        });
    }

    const completionConfig = config.completion;
    if (completionConfig) {
        Object.defineProperty(ConfiguredLogEntryHandle.prototype, "completeWithPromise", {
            value(this: LogEntryHandle<TEntry> & Record<string, unknown>, promise: Promise<unknown>, completeLabel?: StyledText) {
                promise.finally(() => {
                    this[completionConfig.completedField] = true;
                    if (completeLabel !== undefined) this[completionConfig.labelField] = completeLabel;
                });
            },
            enumerable: false,
            configurable: true,
        });
    }

    return ConfiguredLogEntryHandle as never;
}

const PROGRESS_FIELDS = [
    { property: "label", backingSlot: "_label" },
    { property: "value", backingSlot: "_value" },
    { property: "max", backingSlot: "_max" },
    { property: "completed", backingSlot: "_completed" },
] as const satisfies readonly LogEntryFieldBinding<ProgressOutputEntry>[];

const GRID_FIELDS = [
    { property: "data", backingSlot: "_data" },
    { property: "columns", backingSlot: "_columns" },
    { property: "title", backingSlot: "_title" },
] as const satisfies readonly LogEntryFieldBinding<GridOutputEntry>[];

const TEXT_FIELDS = [
    { property: "text", backingSlot: "_text" },
    { property: "language", backingSlot: "_language" },
    { property: "title", backingSlot: "_title" },
    { property: "wordWrap", backingSlot: "_wordWrap" },
    { property: "lineNumbers", backingSlot: "_lineNumbers" },
    { property: "minimap", backingSlot: "_minimap" },
] as const satisfies readonly LogEntryFieldBinding<TextOutputEntry>[];

const MARKDOWN_FIELDS = [
    { property: "text", backingSlot: "_text" },
    { property: "title", backingSlot: "_title" },
] as const satisfies readonly LogEntryFieldBinding<MarkdownOutputEntry>[];

const MERMAID_FIELDS = [
    { property: "text", backingSlot: "_text" },
    { property: "title", backingSlot: "_title" },
] as const satisfies readonly LogEntryFieldBinding<MermaidOutputEntry>[];

export const PROGRESS_HANDLE_CONFIG = {
    fields: PROGRESS_FIELDS,
    completion: { completedField: "completed", labelField: "label" },
} satisfies LogEntryHandleConfig<ProgressOutputEntry>;

export const GRID_HANDLE_CONFIG = {
    fields: GRID_FIELDS,
    open: {
        capability: "content.view",
        representation: "grid",
        content: (handle: LogEntryHandle<object>) => JSON.stringify((handle as unknown as { _data: unknown[] })._data, null, 2),
        language: "json",
        titleField: "title",
        defaultTitle: "Grid Data",
        failureLabel: "Failed to open Grid editor",
    },
} satisfies LogEntryHandleConfig<GridOutputEntry>;

export const TEXT_HANDLE_CONFIG = {
    fields: TEXT_FIELDS,
    open: {
        capability: "text.open",
        content: (handle: LogEntryHandle<object>) => (handle as unknown as { _text: string })._text,
        language: (handle: LogEntryHandle<object>) => (handle as unknown as { _language?: string })._language || "plaintext",
        titleField: "title",
        defaultTitle: "Text",
        failureLabel: "Failed to open text editor",
    },
} satisfies LogEntryHandleConfig<TextOutputEntry>;

export const MARKDOWN_HANDLE_CONFIG = {
    fields: MARKDOWN_FIELDS,
    open: {
        capability: "content.view",
        representation: "markdown",
        content: (handle: LogEntryHandle<object>) => (handle as unknown as { _text: string })._text,
        language: "markdown",
        titleField: "title",
        defaultTitle: "Markdown",
        failureLabel: "Failed to open Markdown editor",
    },
} satisfies LogEntryHandleConfig<MarkdownOutputEntry>;

export const MERMAID_HANDLE_CONFIG = {
    fields: MERMAID_FIELDS,
    open: {
        capability: "content.view",
        representation: "mermaid",
        content: (handle: LogEntryHandle<object>) => (handle as unknown as { _text: string })._text,
        language: "mermaid",
        titleField: "title",
        defaultTitle: "Mermaid Diagram",
        failureLabel: "Failed to open Mermaid editor",
    },
} satisfies LogEntryHandleConfig<MermaidOutputEntry>;

const ProgressHandle = createHandleClass<ProgressOutputEntry, typeof PROGRESS_HANDLE_CONFIG>(PROGRESS_HANDLE_CONFIG);
const GridHandle = createHandleClass<GridOutputEntry, typeof GRID_HANDLE_CONFIG>(GRID_HANDLE_CONFIG);
const TextHandle = createHandleClass<TextOutputEntry, typeof TEXT_HANDLE_CONFIG>(TEXT_HANDLE_CONFIG);
const MarkdownHandle = createHandleClass<MarkdownOutputEntry, typeof MARKDOWN_HANDLE_CONFIG>(MARKDOWN_HANDLE_CONFIG);
const MermaidHandle = createHandleClass<MermaidOutputEntry, typeof MERMAID_HANDLE_CONFIG>(MERMAID_HANDLE_CONFIG);

export type ProgressHandle = InstanceType<typeof ProgressHandle>;
export type GridHandle = InstanceType<typeof GridHandle>;
export type TextHandle = InstanceType<typeof TextHandle>;
export type MarkdownHandle = InstanceType<typeof MarkdownHandle>;
export type MermaidHandle = InstanceType<typeof MermaidHandle>;
export type Progress = ProgressHandle;
export type Grid = GridHandle;
export type Text = TextHandle;
export type Markdown = MarkdownHandle;
export type Mermaid = MermaidHandle;

export function createProgressHandle(entryId: string, vm: LogViewEditor, initial: Record<string, unknown>): ProgressHandle {
    return new ProgressHandle(entryId, vm, initial);
}

export function createGridHandle(entryId: string, vm: LogViewEditor, initial: Record<string, unknown>): GridHandle {
    return new GridHandle(entryId, vm, initial);
}

export function createTextHandle(entryId: string, vm: LogViewEditor, initial: Record<string, unknown>): TextHandle {
    return new TextHandle(entryId, vm, initial);
}

export function createMarkdownHandle(entryId: string, vm: LogViewEditor, initial: Record<string, unknown>): MarkdownHandle {
    return new MarkdownHandle(entryId, vm, initial);
}

export function createMermaidHandle(entryId: string, vm: LogViewEditor, initial: Record<string, unknown>): MermaidHandle {
    return new MermaidHandle(entryId, vm, initial);
}
