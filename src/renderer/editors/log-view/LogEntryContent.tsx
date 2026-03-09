import { LogEntry, ConfirmDialogData, TextDialogData, ButtonsDialogData, isLogEntry, isOutputEntry, StyledText } from "./logTypes";
import { LogMessageView } from "./LogMessageView";
import { ConfirmDialogView } from "./items/ConfirmDialogView";
import { TextInputDialogView } from "./items/TextInputDialogView";
import { ButtonsDialogView } from "./items/ButtonsDialogView";
import color from "../../theme/color";

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
    const label = entry.data?.title || entry.data?.message || "";
    const resolved = entry.data?.button !== undefined;
    return (
        <div style={stubStyle}>
            [{entry.type}] {typeof label === "string" ? label : ""}
            {resolved && <span style={{ color: color.text.dark }}> — answered: {entry.data.button}</span>}
        </div>
    );
}

function OutputEntryStub({ entry }: { entry: LogEntry }) {
    const label = entry.data?.label || entry.data?.title || "";
    return (
        <div style={stubStyle}>
            [{entry.type}] {typeof label === "string" ? label : ""}
        </div>
    );
}

function UnknownEntryView({ entry }: { entry: LogEntry }) {
    let preview: string;
    try {
        preview = JSON.stringify(entry.data).slice(0, 200);
    } catch {
        preview = String(entry.data);
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
    if (isLogEntry(entry)) {
        return <LogMessageView entry={entry as LogEntry<StyledText>} />;
    }

    switch (entry.type) {
        case "input.confirm":
            return <ConfirmDialogView entry={entry as LogEntry<ConfirmDialogData>} />;
        case "input.text":
            return (
                <TextInputDialogView
                    entry={entry as LogEntry<TextDialogData>}
                    updateEntry={updateEntry as any}
                />
            );
        case "input.buttons":
            return <ButtonsDialogView entry={entry as LogEntry<ButtonsDialogData>} />;
    }

    if (entry.type.startsWith("input.")) {
        return <DialogEntryStub entry={entry} />;
    }
    if (isOutputEntry(entry)) {
        return <OutputEntryStub entry={entry} />;
    }
    return <UnknownEntryView entry={entry} />;
}
