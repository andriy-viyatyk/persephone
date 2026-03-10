import { Component, ReactNode } from "react";
import { LogEntry, ConfirmEntry, TextInputEntry, ButtonsEntry, CheckboxesEntry, RadioboxesEntry, SelectEntry, ProgressOutputEntry, GridOutputEntry, TextOutputEntry, MarkdownOutputEntry, isLogEntry, isOutputEntry } from "./logTypes";
import { LogMessageView } from "./LogMessageView";
import { ConfirmDialogView } from "./items/ConfirmDialogView";
import { TextInputDialogView } from "./items/TextInputDialogView";
import { ButtonsDialogView } from "./items/ButtonsDialogView";
import { CheckboxesDialogView } from "./items/CheckboxesDialogView";
import { RadioboxesDialogView } from "./items/RadioboxesDialogView";
import { SelectDialogView } from "./items/SelectDialogView";
import { ProgressOutputView } from "./items/ProgressOutputView";
import { GridOutputView } from "./items/GridOutputView";
import { TextOutputView } from "./items/TextOutputView";
import { MarkdownOutputView } from "./items/MarkdownOutputView";
import color from "../../theme/color";

// =============================================================================
// Entry Error Boundary
// =============================================================================

const errorStyle: React.CSSProperties = {
    color: color.misc.red,
    fontSize: 13,
    lineHeight: "18px",
    fontFamily: "Consolas, 'Courier New', monospace",
};

interface EntryErrorBoundaryState {
    error: Error | null;
}

class EntryErrorBoundary extends Component<{ entry: LogEntry; children: ReactNode }, EntryErrorBoundaryState> {
    state: EntryErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): EntryErrorBoundaryState {
        return { error };
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        const { entry } = this.props;
        return (
            <div style={errorStyle}>
                [{entry.type}] render error: {error.message}
            </div>
        );
    }
}

// =============================================================================
// Stubs for unimplemented entry types
// =============================================================================

const stubStyle: React.CSSProperties = {
    color: color.text.light,
    fontSize: 14,
    lineHeight: "18px",
    fontFamily: "Consolas, 'Courier New', monospace",
};

function DialogEntryStub({ entry }: { entry: LogEntry }) {
    const label = entry.title || entry.message || "";
    const resolved = entry.button !== undefined;
    return (
        <div style={stubStyle}>
            [{entry.type}] {typeof label === "string" ? label : ""}
            {resolved && <span style={{ color: color.text.dark }}> — answered: {entry.button}</span>}
        </div>
    );
}

function OutputEntryStub({ entry }: { entry: LogEntry }) {
    const label = entry.label || entry.title || "";
    return (
        <div style={stubStyle}>
            [{entry.type}] {typeof label === "string" ? label : ""}
        </div>
    );
}

function UnknownEntryView({ entry }: { entry: LogEntry }) {
    const { type: _t, id: _i, timestamp: _ts, ...fields } = entry;
    let preview: string;
    try {
        preview = JSON.stringify(fields).slice(0, 200);
    } catch {
        preview = String(fields);
    }
    return (
        <div style={stubStyle}>
            [{entry.type}] {preview}
        </div>
    );
}

// =============================================================================
// Router
// =============================================================================

interface LogEntryContentProps {
    entry: LogEntry;
    updateEntry: (updater: (draft: LogEntry) => void) => void;
}

export function LogEntryContent({ entry, updateEntry }: LogEntryContentProps) {
    return (
        <EntryErrorBoundary entry={entry}>
            <LogEntryContentInner entry={entry} updateEntry={updateEntry} />
        </EntryErrorBoundary>
    );
}

function LogEntryContentInner({ entry, updateEntry }: LogEntryContentProps) {
    if (isLogEntry(entry)) {
        return <LogMessageView entry={entry} />;
    }

    switch (entry.type) {
        case "input.confirm":
            return <ConfirmDialogView entry={entry as ConfirmEntry} />;
        case "input.text":
            return (
                <TextInputDialogView
                    entry={entry as TextInputEntry}
                    updateEntry={updateEntry as any}
                />
            );
        case "input.buttons":
            return <ButtonsDialogView entry={entry as ButtonsEntry} />;
        case "input.checkboxes":
            return (
                <CheckboxesDialogView
                    entry={entry as CheckboxesEntry}
                    updateEntry={updateEntry as any}
                />
            );
        case "input.radioboxes":
            return (
                <RadioboxesDialogView
                    entry={entry as RadioboxesEntry}
                    updateEntry={updateEntry as any}
                />
            );
        case "input.select":
            return (
                <SelectDialogView
                    entry={entry as SelectEntry}
                    updateEntry={updateEntry as any}
                />
            );
    }

    switch (entry.type) {
        case "output.progress":
            return <ProgressOutputView entry={entry as ProgressOutputEntry} />;
        case "output.grid":
            return <GridOutputView entry={entry as GridOutputEntry} />;
        case "output.text":
            return <TextOutputView entry={entry as TextOutputEntry} />;
        case "output.markdown":
            return <MarkdownOutputView entry={entry as MarkdownOutputEntry} />;
    }

    if (entry.type.startsWith("input.")) {
        return <DialogEntryStub entry={entry} />;
    }
    if (isOutputEntry(entry)) {
        return <OutputEntryStub entry={entry} />;
    }
    return <UnknownEntryView entry={entry} />;
}
