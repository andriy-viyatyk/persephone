import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { builtInDialogButtonLabel } from "../../ui/dialogs/dialog-buttons";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import type { LogEntry } from "./logTypes";
import type { LogViewEditor } from "./LogViewEditor";
import { createPanelElement } from "../../uikit/Panel/panel-style";
import { getLogEntryType, isDialogEntry, isOutputEntry } from "./log-entry-types";
import { LOG_ENTRY_VIEW_FACTORIES, type IEntryView } from "./log-entry-view-factories";

export type EntryUpdater<T extends LogEntry> = (updater: (draft: T) => void) => void;

export interface LogEntryContentProps {
    model: LogViewEditor;
    entry: LogEntry;
    updateEntry: EntryUpdater<LogEntry>;
}

function makeChild(props: LogEntryContentProps): IEntryView {
    const definition = getLogEntryType(props.entry.type);
    const factory = LOG_ENTRY_VIEW_FACTORIES.get(props.entry.type);
    if (definition && factory) return factory.create(props);
    if (props.entry.type.startsWith("input.")) return new DialogEntryStubView({ entry: props.entry });
    return new UnknownEntryView({ entry: props.entry });
}

class DialogEntryStubView extends VanillaView<{ entry: LogEntry }> {
    private readonly text = createTextElement("", { size: "base", color: "light" });
    public constructor(props: { entry: LogEntry }) { super(props, document.createElement("span")); }
    setEntry(ctx: LogEntryContentProps): void { this.update({ entry: ctx.entry }); }
    protected onMount(): void { this.root.append(this.text); this.applyProps(this.props); }
    protected onUpdate(props: { entry: LogEntry }): void { this.applyProps(props); }
    private applyProps(props: { entry: LogEntry }): void {
        const label = props.entry.title || props.entry.message || "";
        const text = typeof label === "string" ? label : "";
        if (props.entry.button === undefined) {
            this.text.textContent = `[${props.entry.type}] ${text}`;
            return;
        }
        const button = String(props.entry.buttonLabel ?? builtInDialogButtonLabel(String(props.entry.button)) ?? props.entry.button);
        this.text.textContent = t("logView.dialogAnswered", { type: String(props.entry.type), text, button });
    }
}

class UnknownEntryView extends VanillaView<{ entry: LogEntry }> {
    private readonly text = createTextElement("", { size: "base", color: "light" });
    public constructor(props: { entry: LogEntry }) { super(props, document.createElement("span")); }
    setEntry(ctx: LogEntryContentProps): void { this.update({ entry: ctx.entry }); }
    protected onMount(): void { this.root.append(this.text); this.applyProps(this.props); }
    protected onUpdate(props: { entry: LogEntry }): void { this.applyProps(props); }
    private applyProps(props: { entry: LogEntry }): void {
        const { type: _type, id: _id, timestamp: _timestamp, ...fields } = props.entry;
        let preview: string;
        try {
            preview = JSON.stringify(fields).slice(0, 200);
        } catch (error) {
            preview = errMessage(error, "Unable to inspect entry");
        }
        this.text.textContent = `[${props.entry.type}] ${preview}`;
    }
}

export class LogEntryContentView extends VanillaView<LogEntryContentProps> {
    private childView: IEntryView | undefined;
    private childKind: string | undefined;
    private fallback: HTMLSpanElement | undefined;
    private readonly itemWrapper = createPanelElement({ name: "log-item-wrapper", paddingY: "xs" });

    public constructor(props: LogEntryContentProps) {
        super(props, document.createElement("div"));
        this.root.style.display = "contents";
    }

    protected onMount(): void {
        this.renderEntry(this.props);
    }

    protected onUpdate(props: LogEntryContentProps): void {
        if (this.childKind === props.entry.type && this.childView) {
            try {
                this.childView.setEntry(props);
                return;
            } catch (error) {
                this.showFailure(props.entry, error);
                return;
            }
        }
        this.renderEntry(props);
    }

    protected onDispose(): void {
        this.fallback = undefined;
        this.childKind = undefined;
    }

    private renderEntry(props: LogEntryContentProps): void {
        this.clearChild();
        this.fallback = undefined;
        try {
            const view = makeChild(props);
            this.childView = this.child(view);
            this.childKind = props.entry.type;
            if (isDialogEntry(props.entry) || isOutputEntry(props.entry)) {
                this.itemWrapper.replaceChildren(this.childView.root);
                if (this.root.firstElementChild !== this.itemWrapper) this.root.replaceChildren(this.itemWrapper);
            } else {
                this.root.replaceChildren(this.childView.root);
            }
            this.childView.mount();
        } catch (error) {
            this.showFailure(props.entry, error);
        }
    }

    private showFailure(entry: LogEntry, error: unknown): void {
        this.clearChild();
        this.fallback = createTextElement(t("logView.entryRenderFailure", { type: entry.type, error: errMessage(error) }), {
            size: "md",
            color: "error",
        });
        this.root.replaceChildren(this.fallback);
    }

    private clearChild(): void {
        const child = this.childView;
        this.childView = undefined;
        this.childKind = undefined;
        if (!child) return;
        try {
            this.releaseChild(child);
        } catch (error) {
            console.error("Log entry child disposal failed", errMessage(error));
        }
    }
}
