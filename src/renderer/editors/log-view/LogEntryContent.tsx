import { LogEntry, isLogEntry, isDialogEntry, isOutputEntry, StyledText } from "./logTypes";
import { LogMessageView } from "./LogMessageView";
import color from "../../theme/color";

// =============================================================================
// Stubs for dialog and output entries (full renderers in future tasks)
// =============================================================================

const stubStyle: React.CSSProperties = {
    color: color.text.light,
    fontSize: 14,
    lineHeight: "18px",
    fontFamily: "Consolas, 'Courier New', monospace",
};

function DialogEntryStub({ entry }: { entry: LogEntry }) {
    const label = entry.data?.title || entry.data?.message || "";
    const resolved = entry.data?.resultButton !== undefined;
    return (
        <div style={stubStyle}>
            [{entry.type}] {typeof label === "string" ? label : ""}
            {resolved && <span style={{ color: color.text.dark }}> — answered: {entry.data.resultButton}</span>}
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

export function LogEntryContent({ entry }: { entry: LogEntry }) {
    if (isLogEntry(entry)) {
        return <LogMessageView entry={entry as LogEntry<StyledText>} />;
    }
    if (isDialogEntry(entry)) {
        return <DialogEntryStub entry={entry} />;
    }
    if (isOutputEntry(entry)) {
        return <OutputEntryStub entry={entry} />;
    }
    return <UnknownEntryView entry={entry} />;
}
