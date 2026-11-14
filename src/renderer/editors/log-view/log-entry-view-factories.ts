import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { LogEntryContentProps, EntryUpdater } from "./LogEntryContent";
import type {
    ButtonsEntry, CheckboxesEntry, ConfirmEntry, GridOutputEntry, LogMessageEntry,
    McpRequestEntry, MarkdownOutputEntry, MermaidOutputEntry, ProgressOutputEntry,
    RadioboxesEntry, SelectEntry, TextInputEntry, TextOutputEntry,
} from "./logTypes";
import { LogMessageView } from "./LogMessageView";
import { ButtonsDialogView } from "./items/ButtonsDialogView";
import { CheckboxesDialogView } from "./items/CheckboxesDialogView";
import { ConfirmDialogView } from "./items/ConfirmDialogView";
import { RadioboxesDialogView } from "./items/RadioboxesDialogView";
import { SelectDialogView } from "./items/SelectDialogView";
import { TextInputDialogView } from "./items/TextInputDialogView";
import { GridOutputView } from "./items/GridOutputView";
import { MarkdownOutputView } from "./items/MarkdownOutputView";
import { McpRequestView } from "./items/McpRequestView";
import { MermaidOutputView } from "./items/MermaidOutputView";
import { ProgressOutputView } from "./items/ProgressOutputView";
import { TextOutputView } from "./items/TextOutputView";

export interface IEntryView {
    readonly root: HTMLElement;
    mount(): void;
    dispose(): void;
    setEntry(ctx: LogEntryContentProps): void;
}

export interface IEntryViewFactory {
    create(ctx: LogEntryContentProps): IEntryView;
}

class EntryViewAdapter<P> extends VanillaView<LogEntryContentProps> implements IEntryView {
    constructor(
        ctx: LogEntryContentProps,
        private readonly view: VanillaView<P>,
        private readonly project: (ctx: LogEntryContentProps) => P,
    ) {
        super(ctx, view.root);
    }

    setEntry(ctx: LogEntryContentProps): void {
        this.update(ctx);
    }

    protected onMount(): void {
        this.child(this.view).mount();
    }

    protected onUpdate(ctx: LogEntryContentProps): void {
        this.view.update(this.project(ctx));
    }
}

function logMessage(ctx: LogEntryContentProps): { entry: LogMessageEntry } {
    return { entry: ctx.entry as LogMessageEntry };
}

function confirmDialog(ctx: LogEntryContentProps): { model: LogEntryContentProps["model"]; entry: ConfirmEntry } {
    return { model: ctx.model, entry: ctx.entry as ConfirmEntry };
}

function textInputDialog(ctx: LogEntryContentProps): {
    model: LogEntryContentProps["model"];
    entry: TextInputEntry;
    updateEntry: EntryUpdater<TextInputEntry>;
} {
    return {
        model: ctx.model,
        entry: ctx.entry as TextInputEntry,
        updateEntry: ctx.updateEntry as EntryUpdater<TextInputEntry>,
    };
}

function buttonsDialog(ctx: LogEntryContentProps): { model: LogEntryContentProps["model"]; entry: ButtonsEntry } {
    return { model: ctx.model, entry: ctx.entry as ButtonsEntry };
}

function checkboxesDialog(ctx: LogEntryContentProps): {
    model: LogEntryContentProps["model"];
    entry: CheckboxesEntry;
    updateEntry: EntryUpdater<CheckboxesEntry>;
} {
    return {
        model: ctx.model,
        entry: ctx.entry as CheckboxesEntry,
        updateEntry: ctx.updateEntry as EntryUpdater<CheckboxesEntry>,
    };
}

function radioboxesDialog(ctx: LogEntryContentProps): {
    model: LogEntryContentProps["model"];
    entry: RadioboxesEntry;
    updateEntry: EntryUpdater<RadioboxesEntry>;
} {
    return {
        model: ctx.model,
        entry: ctx.entry as RadioboxesEntry,
        updateEntry: ctx.updateEntry as EntryUpdater<RadioboxesEntry>,
    };
}

function selectDialog(ctx: LogEntryContentProps): {
    model: LogEntryContentProps["model"];
    entry: SelectEntry;
    updateEntry: EntryUpdater<SelectEntry>;
} {
    return {
        model: ctx.model,
        entry: ctx.entry as SelectEntry,
        updateEntry: ctx.updateEntry as EntryUpdater<SelectEntry>,
    };
}

function progressOutput(ctx: LogEntryContentProps): { entry: ProgressOutputEntry } {
    return { entry: ctx.entry as ProgressOutputEntry };
}

function gridOutput(ctx: LogEntryContentProps): { model: LogEntryContentProps["model"]; entry: GridOutputEntry } {
    return { model: ctx.model, entry: ctx.entry as GridOutputEntry };
}

function textOutput(ctx: LogEntryContentProps): { entry: TextOutputEntry } {
    return { entry: ctx.entry as TextOutputEntry };
}

function markdownOutput(ctx: LogEntryContentProps): { entry: MarkdownOutputEntry } {
    return { entry: ctx.entry as MarkdownOutputEntry };
}

function mermaidOutput(ctx: LogEntryContentProps): { entry: MermaidOutputEntry } {
    return { entry: ctx.entry as MermaidOutputEntry };
}

function mcpRequestOutput(ctx: LogEntryContentProps): { entry: McpRequestEntry } {
    return { entry: ctx.entry as McpRequestEntry };
}

function factory<P>(create: (ctx: LogEntryContentProps) => VanillaView<P>, project: (ctx: LogEntryContentProps) => P): IEntryViewFactory {
    return { create: (ctx) => new EntryViewAdapter(ctx, create(ctx), project) };
}

export const LOG_ENTRY_VIEW_FACTORIES: ReadonlyMap<string, IEntryViewFactory> = new Map<string, IEntryViewFactory>([
    ["log.log", factory((ctx) => new LogMessageView(logMessage(ctx)), logMessage)],
    ["log.text", factory((ctx) => new LogMessageView(logMessage(ctx)), logMessage)],
    ["log.info", factory((ctx) => new LogMessageView(logMessage(ctx)), logMessage)],
    ["log.warn", factory((ctx) => new LogMessageView(logMessage(ctx)), logMessage)],
    ["log.error", factory((ctx) => new LogMessageView(logMessage(ctx)), logMessage)],
    ["log.success", factory((ctx) => new LogMessageView(logMessage(ctx)), logMessage)],
    ["input.confirm", factory((ctx) => new ConfirmDialogView(confirmDialog(ctx)), confirmDialog)],
    ["input.text", factory((ctx) => new TextInputDialogView(textInputDialog(ctx)), textInputDialog)],
    ["input.buttons", factory((ctx) => new ButtonsDialogView(buttonsDialog(ctx)), buttonsDialog)],
    ["input.checkboxes", factory((ctx) => new CheckboxesDialogView(checkboxesDialog(ctx)), checkboxesDialog)],
    ["input.radioboxes", factory((ctx) => new RadioboxesDialogView(radioboxesDialog(ctx)), radioboxesDialog)],
    ["input.select", factory((ctx) => new SelectDialogView(selectDialog(ctx)), selectDialog)],
    ["output.progress", factory((ctx) => new ProgressOutputView(progressOutput(ctx)), progressOutput)],
    ["output.grid", factory((ctx) => new GridOutputView(gridOutput(ctx)), gridOutput)],
    ["output.text", factory((ctx) => new TextOutputView(textOutput(ctx)), textOutput)],
    ["output.markdown", factory((ctx) => new MarkdownOutputView(markdownOutput(ctx)), markdownOutput)],
    ["output.mermaid", factory((ctx) => new MermaidOutputView(mermaidOutput(ctx)), mermaidOutput)],
    ["output.mcp-request", factory((ctx) => new McpRequestView(mcpRequestOutput(ctx)), mcpRequestOutput)],
]);
